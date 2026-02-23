import { describe, it, expect, beforeEach } from 'vitest';
import { CommandManager } from "./command-manager.js";

describe('CommandManager', () => {
  let manager: CommandManager;

  beforeEach(() => {
    manager = new CommandManager();
    // Mock internal state for testing
    (manager as any).commands = [{
      name: 'test',
      description: 'test command',
      parameters: { type: 'object', properties: { input: { type: 'string' } }, required: ['input'] },
      script: 'echo {{input}}',
      filePath: '/fake.md'
    }];
  });

  it('should resolve script for normal execution', () => {
    const script = manager.resolveScript('test', { input: 'hello' });
    expect(script).toBe("echo 'hello'");
  });

  it('should resolve script with {{ }} in input', () => {
    const script = manager.resolveScript('test', { input: 'hello {{world}}' });
    expect(script).toBe("echo 'hello {{world}}'");
  });

  it('should return null when required argument is missing', () => {
    const script = manager.resolveScript('test', {});
    expect(script).toBeNull();
  });

  it('should return specific error from executeCommand when arguments are missing', async () => {
    const result = await manager.executeCommand('test', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing required arguments: input");
  });
});
