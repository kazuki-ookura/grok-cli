import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Interface for file suggestions
 */
export interface FileSuggestion {
  command: string; // The @path string to insert
  description: string; // Brief info about the file/directory
}

/**
 * Get file and directory suggestions matching a partial path
 * @param partialPath The path after the '@' symbol
 * @param limit Maximum number of suggestions to return
 * @returns Array of file suggestions
 */
export async function getFileSuggestions(
  partialPath: string,
  limit: number = 8
): Promise<FileSuggestion[]> {
  try {
    const cwd = process.cwd();
    let searchDir = cwd;
    let fileNamePart = partialPath;

    // Handle nested paths like @src/util
    if (partialPath.includes('/')) {
      const lastSlashIndex = partialPath.lastIndexOf('/');
      const dirPart = partialPath.substring(0, lastSlashIndex);
      fileNamePart = partialPath.substring(lastSlashIndex + 1);
      searchDir = path.join(cwd, dirPart);
    }

    // Verify search directory exists and is a directory
    try {
      const stats = await fs.stat(searchDir);
      if (!stats.isDirectory()) {
        return [];
      }
    } catch {
      return [];
    }

    const entries = await fs.readdir(searchDir, { withFileTypes: true });
    
    const suggestions: FileSuggestion[] = [];
    
    for (const entry of entries) {
      if (entry.name.startsWith('.') && !fileNamePart.startsWith('.')) {
        continue; // Skip hidden files unless explicitly requested
      }

      if (entry.name.toLowerCase().startsWith(fileNamePart.toLowerCase())) {
        let fullPath = partialPath.includes('/') 
          ? `${partialPath.substring(0, partialPath.lastIndexOf('/'))}/${entry.name}`
          : entry.name;
        
        const isDir = entry.isDirectory();
        if (isDir) {
          fullPath += '/';
        }

        suggestions.push({
          command: `@${fullPath}`,
          description: isDir ? "Directory" : "File"
        });

        // Look one level deeper if it's a directory
        if (isDir && suggestions.length < limit) {
          try {
            const subDirPath = path.join(searchDir, entry.name);
            const subEntries = await fs.readdir(subDirPath, { withFileTypes: true });
            for (const subEntry of subEntries) {
              if (subEntry.name.startsWith('.')) continue;
              
              let subFullPath = `${fullPath}${subEntry.name}`;
              const isSubDir = subEntry.isDirectory();
              if (isSubDir) subFullPath += '/';
              
              suggestions.push({
                command: `@${subFullPath}`,
                description: isSubDir ? "Directory" : "File"
              });
              
              if (suggestions.length >= limit) break;
            }
          } catch {
            // Ignore permission or other read errors for subdirectories
          }
        }
      }

      if (suggestions.length >= limit) break;
    }

    return suggestions;
  } catch (error) {
    console.error("Error getting file suggestions:", error);
    return [];
  }
}
