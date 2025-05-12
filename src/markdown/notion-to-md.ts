import { Client } from "@notionhq/client";
import { GetBlockResponse } from "@notionhq/client/build/src/api-endpoints";
import { NotionToMarkdown as N2MInterface } from "../types";
import { MdBlock, CustomTransformer, NotionToMarkdownOptions } from "./types";

/**
 * NotionToMarkdown class to convert Notion blocks to markdown
 */
export class NotionToMarkdown implements N2MInterface {
  private notion: Client;
  private customTransformers: Map<string, CustomTransformer>;
  
  constructor(options: NotionToMarkdownOptions) {
    this.notion = options.notionClient;
    this.customTransformers = new Map();
    
    if (options.customTransformers) {
      Object.entries(options.customTransformers).forEach(([type, transformer]) => {
        this.setCustomTransformer(type, transformer);
      });
    }
  }
  
  /**
   * Register a custom transformer for a specific block type
   */
  setCustomTransformer(type: string, transformer: CustomTransformer): void {
    this.customTransformers.set(type, transformer);
  }
  
  /**
   * Convert a block to markdown based on its type
   */
  private blockToMarkdown(block: MdBlock): string {
    // Use custom transformer if available
    if (block.type && this.customTransformers.has(block.type)) {
      const transformer = this.customTransformers.get(block.type);
      if (transformer) {
        return transformer(block);
      }
    }
    
    // Default transformers for common block types
    switch (block.type) {
      case "paragraph":
        return this.paragraphToMarkdown(block);
      case "heading_1":
        return `# ${this.richTextToPlain(block.heading_1?.rich_text || [])}\n\n`;
      case "heading_2":
        return `## ${this.richTextToPlain(block.heading_2?.rich_text || [])}\n\n`;
      case "heading_3":
        return `### ${this.richTextToPlain(block.heading_3?.rich_text || [])}\n\n`;
      case "bulleted_list_item":
        return `* ${this.richTextToPlain(block.bulleted_list_item?.rich_text || [])}\n`;
      case "numbered_list_item":
        return `1. ${this.richTextToPlain(block.numbered_list_item?.rich_text || [])}\n`;
      case "to_do":
        const checked = block.to_do?.checked ? "x" : " ";
        return `- [${checked}] ${this.richTextToPlain(block.to_do?.rich_text || [])}\n`;
      case "image":
        const url = block.image?.file?.url || block.image?.external?.url || "";
        return `![Image](${url})\n\n`;
      case "code":
        const language = block.code?.language || "";
        const code = this.richTextToPlain(block.code?.rich_text || []);
        return `\`\`\`${language}\n${code}\n\`\`\`\n\n`;
      case "quote":
        return `> ${this.richTextToPlain(block.quote?.rich_text || [])}\n\n`;
      // Add more cases as needed
      default:
        return "";
    }
  }
  
  /**
   * Convert paragraph block to markdown
   */
  private paragraphToMarkdown(block: MdBlock): string {
    if (!block.paragraph?.rich_text || block.paragraph.rich_text.length === 0) {
      return "\n";
    }
    
    return `${this.richTextToMarkdown(block.paragraph.rich_text)}\n\n`;
  }
  
  /**
   * Convert rich text to plain text
   */
  private richTextToPlain(richText: any[]): string {
    if (!richText || richText.length === 0) return "";
    return richText.map(text => text.plain_text).join("") || "";
  }
  
  /**
   * Convert rich text to markdown with formatting
   */
  private richTextToMarkdown(richText: any[]): string {
    if (!richText || richText.length === 0) return "";
    
    return richText.map(text => {
      let content = text.plain_text;
      
      // Apply formatting
      if (text.annotations.bold) content = `**${content}**`;
      if (text.annotations.italic) content = `*${content}*`;
      if (text.annotations.strikethrough) content = `~~${content}~~`;
      if (text.annotations.code) content = `\`${content}\``;
      
      // Handle links
      if (text.href) {
        content = `[${content}](${text.href})`;
      }
      
      return content;
    }).join("");
  }
  
  /**
   * Convert Notion block response to our internal MdBlock format
   */
  private convertNotionBlockToMdBlock(block: GetBlockResponse): MdBlock {
    // Basic conversion - this can be expanded as needed
    return block as unknown as MdBlock;
  }
  
  /**
   * Fetch and convert all blocks in a page to markdown
   */
  async pageToMarkdown(pageId: string): Promise<MdBlock[]> {
    const blocks: MdBlock[] = [];
    
    try {
      let hasMore = true;
      let startCursor: string | undefined = undefined;
      
      while (hasMore) {
        const response: any = await this.notion.blocks.children.list({
          block_id: pageId,
          start_cursor: startCursor,
        });
        
        const convertedBlocks = response.results.map((block: GetBlockResponse) => 
          this.convertNotionBlockToMdBlock(block)
        );
        
        blocks.push(...convertedBlocks);
        hasMore = response.has_more;
        startCursor = response.next_cursor;
      }
      
      // For each block, fetch children recursively if they have children
      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        if (block.has_children) {
          const children = await this.pageToMarkdown(block.id || '');
          block.children = children;
        }
      }
      
      return blocks;
    } catch (error) {
      console.error(`Error fetching blocks for page ${pageId}:`, error);
      return [];
    }
  }
  
  /**
   * Convert a list of blocks to a markdown string
   */
  toMarkdownString(blocks: MdBlock[]): { parent: string } {
    let markdown = "";
    
    for (const block of blocks) {
      // Add the markdown for this block
      markdown += this.blockToMarkdown(block);
      
      // Process children if any
      if (block.children && block.children.length > 0) {
        const childrenMarkdown = this.toMarkdownString(block.children).parent;
        // Apply indentation for nested content
        markdown += childrenMarkdown.split("\n").map(line => `  ${line}`).join("\n");
      }
    }
    
    return { parent: markdown };
  }
}
