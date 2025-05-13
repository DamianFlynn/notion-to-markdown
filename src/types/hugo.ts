/**
 * Hugo content types and structure configuration
 */

/**
 * Defines the structure of Hugo content bundles
 */
export interface HugoBundleConfig {
  /**
   * Whether to use bundle structure (folder with index.md) or flat structure (single md file)
   */
  useBundle: boolean;
  
  /**
   * The name of the index file in the bundle (typically "index.md" or "_index.md")
   */
  indexFile: string;
  
  /**
   * Special pages that should use a specific structure
   */
  specialPages: Record<string, SpecialPageConfig>;
  
  /**
   * Default path mappings for different content types
   */
  contentTypes: Record<string, ContentTypeConfig>;
}

/**
 * Configuration for a special page
 */
export interface SpecialPageConfig {
  /**
   * Content type of the special page
   */
  type: string;
  
  /**
   * Path where the special page should be stored
   */
  path: string;
  
  /**
   * Whether this page should use a bundle structure
   */
  useBundle?: boolean;
  
  /**
   * Index file name override for this special page
   */
  indexFile?: string;
}

/**
 * Configuration for a content type
 */
export interface ContentTypeConfig {
  /**
   * Base path for this content type
   */
  path: string;
  
  /**
   * Whether this content type uses bundle structure
   */
  useBundle: boolean;
  
  /**
   * The name of the index file in the bundle
   */
  indexFile: string;
}

/**
 * Default Hugo bundle configuration
 */
export const DEFAULT_HUGO_BUNDLE_CONFIG: HugoBundleConfig = {
  useBundle: true,
  indexFile: 'index.md',
  specialPages: {
    'about': { type: 'page', path: 'about' },
    'aboutme': { type: 'page', path: 'about' },
    'disclaimer': { type: 'page', path: 'disclaimer' },
    'privacy': { type: 'page', path: 'privacy' },
    'contact': { type: 'page', path: 'contact' }
  },
  contentTypes: {
    'posts': {
      path: 'content/posts',
      useBundle: true,
      indexFile: 'index.md'
    },
    'page': {
      path: 'content',
      useBundle: true,
      indexFile: 'index.md'
    }
  }
};
