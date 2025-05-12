import { Client } from "@notionhq/client";
import {
  GetBlockResponse,
  RichTextItemResponse
} from "@notionhq/client/build/src/api-endpoints";

// Define our own EmojiRequest type as a string
export type EmojiRequest = string;

export interface BlockText {
  plain_text: string;
  href?: string;
  annotations: {
    bold: boolean;
    italic: boolean;
    strikethrough: boolean;
    underline: boolean;
    code: boolean;
    color: string;
  };
}

export type BlockType =
  | 'paragraph'
  | 'heading_1'
  | 'heading_2'
  | 'heading_3'
  | 'bulleted_list_item'
  | 'numbered_list_item'
  | 'to_do'
  | 'toggle'
  | 'child_page'
  | 'child_database'
  | 'embed'
  | 'image'
  | 'video'
  | 'file'
  | 'pdf'
  | 'bookmark'
  | 'callout'
  | 'quote'
  | 'equation'
  | 'divider'
  | 'table_of_contents'
  | 'column'
  | 'column_list'
  | 'link_preview'
  | 'synced_block'
  | 'template'
  | 'code'
  | 'table'
  | 'table_row';

export interface CalloutIcon {
  type: 'emoji' | 'file' | 'external';
  emoji?: string;
  file?: {
    url: string;
    expiry_time: string;
  };
  external?: {
    url: string;
  };
}

export interface MdBlock {
  type: BlockType;
  id?: string;
  has_children?: boolean;
  text?: BlockText[];
  children?: MdBlock[];
  language?: string;
  checked?: boolean;
  callout?: {
    icon?: CalloutIcon;
    rich_text: BlockText[];
  };
  image?: {
    file?: { url: string };
    external?: { url: string };
    caption?: BlockText[];
  };
  paragraph?: {
    rich_text: BlockText[];
  };
  heading_1?: {
    rich_text: BlockText[];
  };
  heading_2?: {
    rich_text: BlockText[];
  };
  heading_3?: {
    rich_text: BlockText[];
  };
  bulleted_list_item?: {
    rich_text: BlockText[];
  };
  numbered_list_item?: {
    rich_text: BlockText[];
  };
  to_do?: {
    rich_text: BlockText[];
    checked: boolean;
  };
  quote?: {
    rich_text: BlockText[];
  };
  code?: {
    rich_text: BlockText[];
    language: string;
  };
  [key: string]: any;
}

export type CustomTransformer = (block: MdBlock) => string;

export interface NotionToMarkdownOptions {
  notionClient: any;
  customTransformers?: Record<string, CustomTransformer>;
}

export interface ContentFile {
  filename: string;
  filepath: string;
  metadata: any;
  expiry_time: string | null | undefined;
  last_updated?: string;
}
