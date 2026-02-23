import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { GrokTool } from '../grok/client.js';
import { ConfirmationService } from '../utils/confirmation-service.js';

/**
 * Represents a custom command (tool) defined in a Markdown file.
 *
 * @example
 * ```markdown
 * ---
 * name: deploy
 * description: Deploy the application
 * ---
 * ## Parameters
 * ```json
 * { "type": "object", "properties": { "env": { "type": "string" } }, "required": ["env"] }
 * ```
 * ## Script
 * ```bash
 * ./deploy.sh {{env}}
 * ```
 * ```
 */
export interface Command {
  /** Command name (from YAML frontmatter `name` field) */
  name: string;
  /** Command description (from YAML frontmatter `description` field) */
  description: string;
  /** Parameter schema for the command (JSON Schema object) */
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  /** Bash script template to execute */
  script: string;
  /** Absolute path to the command definition file */
  filePath: string;
}

/**
 * Manages custom commands (Markdown-based tool definitions) for the Grok Agent.
 * Scans `.grok/commands` and `.claude/commands` directories in the project,
 * parses Markdown files, and integrates them as Grok tools.
 *
 * @example
 * ```typescript
 * const manager = new CommandManager();
 * await manager.loadCommands(process.cwd());
 * const tools = manager.getTools(); // Returns GrokTool[]
 * ```
 */
export class CommandManager {
  private commands: Command[] = [];

  constructor() {}

  /**
   * Finds the project root from the given directory and loads
   * all command definitions from the commands directories.
   *
   * @param cwd - The starting directory path for the search.
   * @returns Array of parsed commands.
   */
  public async loadCommands(cwd: string): Promise<Command[]> {
    this.commands = [];
    const root = this.findProjectRoot(cwd);
    if (!root) return [];

    const grokCommandsPath = path.join(root, '.grok', 'commands');
    const claudeCommandsPath = path.join(root, '.claude', 'commands');

    await this.loadCommandsFromDirectory(grokCommandsPath);
    await this.loadCommandsFromDirectory(claudeCommandsPath);

    return this.commands;
  }

  /**
   * Converts loaded commands into GrokTool array format.
   * Each tool is registered with a `cmd__` prefix.
   *
   * @returns Array of tools in GrokTool format.
   */
  public getTools(): GrokTool[] {
    return this.commands.map((cmd) => ({
      type: "function" as const,
      function: {
        name: `cmd__${cmd.name}`,
        description: `[Custom Command] ${cmd.description}`,
        parameters: cmd.parameters as {
          type: "object";
          properties: Record<string, any>;
          required: string[];
        },
      },
    }));
  }

  /**
   * Resolves the final script string by replacing placeholders with
   * shell-escaped argument values. Useful for previewing the command
   * before execution (e.g. for user confirmation).
   *
   * @param name - Command name (without `cmd__` prefix).
   * @param args - Object containing argument key-value pairs.
   * @returns The resolved script string, or null if the command is not found.
   */
  public resolveScript(
    name: string,
    args: Record<string, unknown>
  ): string | null {
    const command = this.getCommand(name);
    if (!command) return null;

    let script = command.script;
    for (const [key, value] of Object.entries(args)) {
      const placeholder = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      script = script.replace(placeholder, this.escapeShellArg(String(value)));
    }
    // Reject execution if any placeholders remain unresolved
    const unresolved = script.match(/\{\{[^}]+\}\}/g);
    if (unresolved) {
      return null;
    }
    return script;
  }

  /**
   * Retrieves a Command object by name.
   *
   * @param name - Command name (without `cmd__` prefix).
   * @returns The matching Command object, or undefined if not found.
   */
  public getCommand(name: string): Command | undefined {
    return this.commands.find((c) => c.name === name);
  }

  /**
   * Executes a command by name with the given arguments.
   * Replaces `{{key}}` placeholders in the script template with argument values,
   * then executes the resulting script via Bash.
   *
   * @param name - Command name (without `cmd__` prefix).
   * @param args - Object containing argument key-value pairs.
   * @returns Execution result with success status, output, and error.
   */
  public async executeCommand(
    name: string,
    args: Record<string, unknown>
  ): Promise<{ success: boolean; output?: string; error?: string }> {
    const script = this.resolveScript(name, args);
    if (script === null) {
      const command = this.getCommand(name);
      if (!command) {
        return { success: false, error: `Unknown command: ${name}` };
      }
      // Unresolved placeholders detected
      const unresolvedMatch = command.script.match(/\{\{[^}]+\}\}/g);
      const missing = unresolvedMatch
        ? unresolvedMatch.map(p => p.replace(/[{}]/g, '')).filter(p => !(p in args))
        : [];
      return {
        success: false,
        error: `Missing required arguments: ${missing.join(', ')}. Command not executed.`
      };
    }

    // Request user confirmation before executing the command
    const confirmationService = ConfirmationService.getInstance();
    const sessionFlags = confirmationService.getSessionFlags();
    if (!sessionFlags.bashCommands && !sessionFlags.allOperations) {
      const confirmationResult = await confirmationService.requestConfirmation({
        operation: `Run custom command: ${name}`,
        filename: script,
        showVSCodeOpen: false,
        content: `Script:\n${script}`
      }, 'bash');

      if (!confirmationResult.confirmed) {
        return {
          success: false,
          error: confirmationResult.feedback || 'Command execution cancelled by user'
        };
      }
    }

    return new Promise((resolve) => {
      exec(script, { timeout: 30000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          resolve({
            success: false,
            error: `Command failed: ${error.message}\n${stderr}`,
          });
        } else {
          resolve({
            success: true,
            output: stdout || stderr || "Command completed successfully.",
          });
        }
      });
    });
  }

  /**
   * Escapes a string to be safely used as a shell argument.
   * Encloses the string in single quotes and escapes any single quotes within.
   *
   * @param arg - The raw string to escape.
   * @returns The shell-safe escaped string.
   */
  private escapeShellArg(arg: string): string {
    return "'" + arg.replace(/'/g, "'\\''" ) + "'";
  }

  /**
   * Traverses parent directories to find the project root.
   * A directory is considered the project root if it contains
   * `.grok`, `.claude`, or `.git`.
   *
   * @param startPath - The starting directory path.
   * @returns The project root path, or null if not found.
   */
  private findProjectRoot(startPath: string): string | null {
    let currentPath = startPath;
    while (currentPath !== path.parse(currentPath).root) {
      if (
        fs.existsSync(path.join(currentPath, '.grok')) ||
        fs.existsSync(path.join(currentPath, '.claude')) ||
        fs.existsSync(path.join(currentPath, '.git'))
      ) {
        return currentPath;
      }
      currentPath = path.dirname(currentPath);
    }

    return null;
  }

  /**
   * Recursively loads `.md` files from the given directory
   * and registers parsed commands.
   *
   * @param dirPath - Path to the commands directory.
   */
  private async loadCommandsFromDirectory(dirPath: string): Promise<void> {
    if (!fs.existsSync(dirPath)) return;

    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          await this.loadCommandsFromDirectory(fullPath);
        } else if (entry.name.endsWith('.md')) {
          const fileContent = await fs.promises.readFile(fullPath, 'utf8');
          const command = this.parseCommand(fileContent, fullPath);
          if (command) {
            this.commands.push(command);
          }
        }
      }
    } catch (error) {
      console.warn(`Failed to load commands from ${dirPath}:`, error);
    }
  }

  /**
   * Parses a Markdown file to extract a command definition.
   *
   * Expected format:
   * ```markdown
   * ---
   * name: command_name
   * description: What this command does
   * ---
   * ## Parameters
   * ```json
   * { "type": "object", "properties": { ... } }
   * ```
   * ## Script
   * ```bash
   * echo "Hello, {{name}}!"
   * ```
   * ```
   *
   * @param content - Full content of the Markdown file.
   * @param filePath - Absolute path to the file being parsed.
   * @returns A Command object on success, or null if parsing fails.
   */
  public parseCommand(content: string, filePath: string): Command | null {
    // Extract YAML frontmatter
    const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!frontmatterMatch) return null;

    const frontmatter = frontmatterMatch[1];
    const body = frontmatterMatch[2];

    const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
    const descMatch = frontmatter.match(/^description:\s*(.+)$/m);

    if (!nameMatch) return null;

    const name = nameMatch[1].trim();
    const description = descMatch ? descMatch[1].trim() : `Custom command: ${name}`;

    // Split body into sections by ## headings for section-aware parsing
    const sections = new Map<string, string>();
    const sectionRegex = /^##\s+(.+)$/gm;
    let lastHeading = '';
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = sectionRegex.exec(body)) !== null) {
      if (lastHeading) {
        sections.set(lastHeading.toLowerCase(), body.slice(lastIndex, match.index));
      }
      lastHeading = match[1].trim();
      lastIndex = match.index + match[0].length;
    }
    if (lastHeading) {
      sections.set(lastHeading.toLowerCase(), body.slice(lastIndex));
    }

    // Extract parameters JSON from ```json block under ## Parameters section
    let parameters: Command['parameters'] = {
      type: "object" as const,
      properties: {},
      required: [],
    };

    const parametersSection = sections.get('parameters');
    if (parametersSection) {
      const jsonMatch = parametersSection.match(/```json\s*\n([\s\S]*?)\n\s*```/);
      if (jsonMatch) {
        try {
          parameters = JSON.parse(jsonMatch[1].trim());
        } catch {
          console.warn(`Failed to parse parameters JSON in ${filePath}`);
        }
      }
    } else {
      // Fallback: search the entire body for backwards compatibility
      const jsonMatch = body.match(/```json\s*\n([\s\S]*?)\n\s*```/);
      if (jsonMatch) {
        try {
          parameters = JSON.parse(jsonMatch[1].trim());
        } catch {
          console.warn(`Failed to parse parameters JSON in ${filePath}`);
        }
      }
    }

    // Extract script from ```bash or ```sh block under ## Script/Command section
    let script = '';
    const scriptSection = sections.get('script') || sections.get('command');
    if (scriptSection) {
      const scriptMatch = scriptSection.match(/```(?:bash|sh)\s*\n([\s\S]*?)\n\s*```/);
      if (scriptMatch) {
        script = scriptMatch[1].trim();
      }
      // If no fenced block, use the raw section content
      if (!script) {
        script = scriptSection.trim();
      }
    } else {
      // Fallback: search the entire body for backwards compatibility
      const scriptMatch = body.match(/```(?:bash|sh)\s*\n([\s\S]*?)\n\s*```/);
      if (scriptMatch) {
        script = scriptMatch[1].trim();
      }
    }

    if (!script) {
      console.warn(`No script found in command file: ${filePath}`);
      return null;
    }

    return {
      name,
      description,
      parameters,
      script,
      filePath,
    };
  }
}
