import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Interface to track processed files to avoid duplicates and potentially circular references
 */
interface ProcessingState {
  processedFiles: Set<string>;
  projectRoot: string;
}

/**
 * Scans for @path/to/file patterns in the message and expands them with file content.
 * 
 * @param message - The user message possibly containing @file references
 * @param cwd - The base directory to resolve relative paths
 * @returns The expanded message with file contents wrapped in blocks
 */
export async function expandFilePaths(message: string, cwd: string = process.cwd()): Promise<string> {
  const state: ProcessingState = {
    processedFiles: new Set(),
    projectRoot: cwd,
  };

  const imports = await findFileReferences(message, cwd);
  if (imports.length === 0) return message;

  let result = '';
  let lastIndex = 0;

  // Sort imports by start position to process them in order
  imports.sort((a, b) => a.start - b.start);

  for (const { start, end, rawPath } of imports) {
    // Add text before the reference
    result += message.substring(lastIndex, start);
    lastIndex = end;

    const fullPath = path.resolve(cwd, rawPath);
    
    // Safety check: ensure file is within current project or at least doesn't traverse upwards too far
    // For now, we allow any file relative to cwd, but we'll track unique files
    if (state.processedFiles.has(fullPath)) {
      result += `\n--- File: ${rawPath} ---\n(File already included above)\n--- End of File: ${rawPath} ---\n`;
      continue;
    }

    try {
      const stats = await fs.stat(fullPath);
      if (stats.isFile()) {
        const content = await fs.readFile(fullPath, 'utf-8');
        state.processedFiles.add(fullPath);
        
        result += `\n--- File: ${rawPath} ---\n${content.trim()}\n--- End of File: ${rawPath} ---\n`;
      } else if (stats.isDirectory()) {
         const entries = await fs.readdir(fullPath, { withFileTypes: true });
         const list = entries.map(e => e.isDirectory() ? `${e.name}/` : e.name).join('\n');
         state.processedFiles.add(fullPath);
         result += `\n--- Directory: ${rawPath} ---\n${list}\n--- End of Directory: ${rawPath} ---\n`;
      } else {
         result += `\n<!-- Skipping ${rawPath}: Not a file or directory. -->\n`;
      }
    } catch (error: any) {
      result += `\n<!-- Failed to read file at "${rawPath}": ${error.message}. CRITICAL: The user provided a malformed path (possibly due to spaces). STOP using tools (Read/Bash) to guess the path. ASK the user to provide the path in quotes: @"path with spaces". -->\n`;
    }
  }

  // Add remaining text
  result += message.substring(lastIndex);

  return result;
}

/**
 * Finds all @path-like references in the text.
 * Supports greedy matching for spaces by checking file existence.
 */
async function findFileReferences(content: string, cwd: string): Promise<Array<{ start: number; end: number; rawPath: string }>> {
  const references: Array<{ start: number; end: number; rawPath: string }> = [];
  let i = 0;
  const len = content.length;

  while (i < len) {
    // Find next @ symbol
    i = content.indexOf('@', i);
    if (i === -1) break;

    // Check if it's a word boundary (prevents matching emails or decorated text)
    if (i > 0 && !isWhitespace(content[i - 1])) {
      i++;
      continue;
    }

    let j = i + 1;
    let rawPath = '';
    let foundEnd = -1;

    // Handle quoted paths: @"path with spaces" (highest priority)
    if (j < len && (content[j] === '"' || content[j] === "'")) {
      const quoteChar = content[j];
      const startQuote = j;
      j++; // skip opening quote
      
      const endQuote = content.indexOf(quoteChar, j);
      if (endQuote !== -1) {
        rawPath = content.slice(j, endQuote);
        foundEnd = endQuote + 1;
      } else {
        j = startQuote; // Unclosed quote, fallback to greedy
      }
    }

    // Greedy matching for unquoted paths
    if (foundEnd === -1) {
      let currentCandidate = "";
      let bestPath = "";
      let bestEnd = -1;
      let k = i + 1;

      // Scan ahead until newline or a very long distance
      while (k < len && content[k] !== '\n' && (k - i) < 255) {
        currentCandidate += content[k];
        
        // Only run fs.stat at word boundaries to reduce I/O overhead
        const nextChar = k + 1 < len ? content[k + 1] : '\n';
        const isBoundary = isWhitespace(nextChar) || nextChar === '\n' || isEndDelimiter(nextChar) || (k - i + 1) >= 255;
        
        if (isBoundary) {
          // Check if the current candidate (potentially with spaces) exists
          const trimmedCandidate = currentCandidate.trim();
          // Remove trailing delimiters from candidate for check
          const cleanCandidate = trimmedCandidate.replace(/[.,;:)\]}"'>]+$/, '');
          
          if (cleanCandidate.length > 0) {
            try {
              const fullPath = path.resolve(cwd, cleanCandidate);
              const stats = await fs.stat(fullPath);
              if (stats.isFile() || stats.isDirectory()) {
                bestPath = cleanCandidate;
                const matchIndex = currentCandidate.lastIndexOf(cleanCandidate);
                bestEnd = i + 1 + matchIndex + cleanCandidate.length;
              }
            } catch {
              // Not a valid path yet, keep looking
            }
          }
        }
        k++;
      }

      if (bestPath) {
        rawPath = bestPath;
        foundEnd = bestEnd;
      } else {
        // Fallback: until next whitespace (original behavior for non-existent/new files)
        let fallbackK = i + 1;
        while (
          fallbackK < len &&
          !isWhitespace(content[fallbackK]) &&
          !isEndDelimiter(content[fallbackK])
        ) {
          fallbackK++;
        }
        rawPath = content.slice(i + 1, fallbackK);
        foundEnd = fallbackK;
      }
    }

    // Basic validation
    if (rawPath.length > 0) {
      references.push({
        start: i,
        end: foundEnd,
        rawPath,
      });
    }

    i = foundEnd;
  }

  return references;
}

function isWhitespace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r';
}

function isEndDelimiter(char: string): boolean {
  // Stop at common ending punctuation that isn't usually part of a filename
  return [',', ';', ')', ']', '}', '"', "'", '>'].includes(char);
}

function isLetter(char: string): boolean {
  const code = char.charCodeAt(0);
  return (
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) || // a-z
    code > 127 // Allow non-ASCII (e.g. Japanese filenames)
  );
}
