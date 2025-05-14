import { Client } from "@notionhq/client";
import { PageObjectResponse, GetBlockResponse } from "@notionhq/client/build/src/api-endpoints";
import { BundlePath } from "./utils/bundle";
import { HugoBundleConfig } from "./types/hugo";

/**
 * Type definitions for the Notion to Markdown application
 */

/**
 * Options for rendering Notion content
 */
export interface RenderOptions {
  /**
   * Notion client instance
   */
  notion?: Client;
  
  /**
   * Whether to download resources
   */
  download?: boolean;
  
  /**
   * Base URL for resources
   */
  baseUrl?: string;
  
  /**
   * Property mapping
   */
  propertyMap?: PropertyMap;
  
  /**
   * Target folder for content
   */
  targetFolder?: string;
  
  /**
   * Hugo bundle configuration
   */
  hugoConfig?: HugoBundleConfig;
}

/**
 * Result of rendering a Notion page
 */
export interface RenderResult {
  /**
   * The rendered markdown content including front matter
   */
  content: string;
  
  /**
   * The title of the page
   */
  title: string;
  
  /**
   * The summary of the page (if available)
   */
  summary?: string;
  
  /**
   * Bundle path information
   */
  bundlePath: BundlePath;
  
  /**
   * Cover image path (if available)
   */
  coverImagePath?: string;
}

/**
 * Property mapping from Notion properties to Hugo front matter
 */
export interface PropertyMap {
  /**
   * Map of property IDs to property specifications
   */
  [key: string]: {
    /**
     * Name to use in the front matter
     */
    name: string;
    
    /**
     * Type of the property
     * Valid types: title, date, select, multi_select, people, status, number, etc.
     */
    type: string;
  };
}

/**
 * Interface for the NotionToMarkdown class
 */
export interface NotionToMarkdown {
  /**
   * Convert a Notion page to Markdown blocks
   * @param pageId ID of the Notion page
   */
  pageToMarkdown(pageId: string): Promise<any[]>;
  
  /**
   * Convert blocks to a markdown string
   * @param blocks Array of blocks to convert
   */
  toMarkdownString(blocks: any[]): { parent: string };
  
  /**
   * Set a custom transformer for a specific block type
   * @param type Block type
   * @param transformer Function to transform the block
   */
  setCustomTransformer(type: string, transformer: (block: any) => string): void;
}

/**
 * Interface for custom block transformer
 */
export interface CustomTransformer {
  (block: any): string;
}
