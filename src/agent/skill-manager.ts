import fs from 'fs';
import path from 'path';

/**
 * MDファイル内に定義されたスキル（プロンプト指示）を表すインターフェース。
 */
export interface Skill {
  /** スキルの名称 (YAMLフロントマターの `name` 値) */
  name: string;
  /** スキルの説明・用途 (YAMLフロントマターの `description` 値) */
  description: string;
  /** スキルの具体的なマークダウン本体内容 */
  content: string;
  /** スキルファイルの絶対パス */
  filePath: string;
}

/**
 * Grok Agent向けのスキル（カスタムシステムプロンプト）を管理するクラス。
 * プロジェクト内の `.grok/skills` および `.claude/skills` ディレクトリを探索し、
 * 定義されたMarkdownファイルをパースしてシステムプロンプトとして統合します。
 */
export class SkillManager {
  private skills: Skill[] = [];

  constructor() {}

  /**
   * 指定されたディレクトリを起点にプロジェクトルートを探し、その配下にある
   * スキルディレクトリから一連のスキルを読み込みむ。
   *
   * @param cwd - 現在の作業ディレクトリなど、検索の起点となるパス。
   * @returns 抽出されたスキルの配列。
   */
  public async loadSkills(cwd: string): Promise<Skill[]> {
    this.skills = [];
    const root = this.findProjectRoot(cwd);
    if (!root) return [];

    const grokSkillsPath = path.join(root, '.grok', 'skills');
    const claudeSkillsPath = path.join(root, '.claude', 'skills');

    await this.loadSkillsFromDirectory(grokSkillsPath);
    await this.loadSkillsFromDirectory(claudeSkillsPath);

    return this.skills;
  }

  /**
   * 起点パスから親ディレクトリへ遡り、プロジェクトのルートディレクトリを特定する。
   * `.grok`, `.claude`, または `.git` ディレクトリが存在する階層をルートとみなす。
   *
   * @param startPath - 検索開始ディレクトリのパス
   * @returns プロジェクトルートのパス、見つからない場合は null。
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
    
    // Check root as well
    if (
      fs.existsSync(path.join(currentPath, '.grok')) ||
      fs.existsSync(path.join(currentPath, '.claude')) ||
      fs.existsSync(path.join(currentPath, '.git'))
    ) {
      return currentPath;
    }
    
    return null;
  }

  /**
   * 指定されたディレクトリから再帰的に `.md` ファイルを読み込み、
   * YAMLフロントマターを解析してスキル情報を登録する。
   *
   * @param dirPath - スキルファイルが配置されたディレクトリのパス。
   */
  private async loadSkillsFromDirectory(dirPath: string): Promise<void> {
    if (!fs.existsSync(dirPath)) return;

    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        
        if (entry.isDirectory()) {
          await this.loadSkillsFromDirectory(fullPath);
        } else if (entry.name.endsWith('.md')) {
          const fileContent = await fs.promises.readFile(fullPath, 'utf8');
          const skill = this.parseSkill(fileContent, fullPath);
          if (skill) {
            this.skills.push(skill);
          }
        }
      }
    } catch (error) {
      console.warn(`Failed to load skills from ${dirPath}:`, error);
    }
  }

  /**
   * マークダウンファイルのテキストからYAMLフロントマターを抽出し、
   * Skillオブジェクトを生成する。
   *
   * @param content - マークダウンファイルのコンテンツ全体
   * @param filePath - 解析対象のファイルパス
   * @returns 成功した場合はSkillオブジェクト、パース不可の場合はnull
   */
  private parseSkill(content: string, filePath: string): Skill | null {
    // Simple YAML frontmatter parser
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!match) return null;

    const frontmatter = match[1];
    const markdownContent = match[2];

    const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
    const descMatch = frontmatter.match(/^description:\s*(.+)$/m);

    if (!nameMatch) return null;

    return {
      name: nameMatch[1].trim(),
      description: descMatch ? descMatch[1].trim() : '',
      content: markdownContent.trim(),
      filePath
    };
  }

  /**
   * 読み込まれた全てのスキルを統合し、Groq Agentのシステムプロンプトに
   * 追加するための拡張文字列（プロンプト）を生成する。
   *
   * @returns スキル定義がフォーマットされた文字列。ロード済スキルが無い場合は空文字。
   */
  public getSystemPromptExtension(): string {
    if (this.skills.length === 0) return '';
    
    let extension = '\n\n# PROJECT SKILLS\n';
    extension += 'You have access to the following custom skills defined in this project workspace. Please adhere to these instructions when fulfilling tasks related to them:\n\n';
    
    for (const skill of this.skills) {
      extension += `## SKILL: ${skill.name}\n`;
      if (skill.description) {
        extension += `**Description**: ${skill.description}\n\n`;
      }
      extension += `${skill.content}\n\n`;
    }
    
    return extension;
  }
}
