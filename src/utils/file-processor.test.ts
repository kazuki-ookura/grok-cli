import { describe, it, expect } from 'vitest';
import { expandFilePaths } from "./file-processor.js";

describe('expandFilePaths', () => {
  it('should list directory contents for directory paths', async () => {
    const result = await expandFilePaths("@src What is this?");
    expect(result).toContain("--- Directory: src ---");
    expect(result).toContain("agent/");
  });

  it('should return explicit error comment for nonexistent paths', async () => {
    const result = await expandFilePaths("@nonexistent_hoge");
    expect(result).toContain('Failed to read file at "nonexistent_hoge"');
  });
});
