import path from 'path';
import fs from 'fs-extra';
import { HugoBundleConfig, DEFAULT_HUGO_BUNDLE_CONFIG } from '../types/hugo';
import slugify from 'slugify';

/**
 * Configuration for the bundle path generator
 */
interface BundlePathOptions {
  /**
   * Title of the page
   */
  title: string;
  
  /**
   * ID of the page
   */
  pageId: string;
  
  /**
   * Content type of the page
   */
  contentType: string;
  
  /**
   * Target folder for the page
   */
  targetFolder: string;
  
  /**
   * Hugo bundle configuration
   */
  bundleConfig?: HugoBundleConfig;
}

/**
 * Represents a bundle's path information
 */
export interface BundlePath {
  /**
   * The relative path to the bundle directory
   */
  bundleDirPath: string;
  
  /**
   * The full path to the index file
   */
  indexFilePath: string;
  
  /**
   * The slug derived from the title
   */
  slug: string;
  
  /**
   * The name of the index file
   */
  indexFileName: string;
  
  /**
   * Whether this is a bundle or flat structure
   */
  isBundle: boolean;
}

/**
 * Creates a valid slug from a title
 */
export function createSlug(title: string): string {
  return slugify(title, {
    lower: true,
    strict: true,
    replacement: '-'
  });
}

/**
 * Generates paths for a Hugo content bundle
 */
export function getBundlePath(options: BundlePathOptions): BundlePath {
  const { title, pageId, contentType, targetFolder, bundleConfig = DEFAULT_HUGO_BUNDLE_CONFIG } = options;
  
  // Create a slug from the title
  const slug = createSlug(title);
  
  // Check if this is a special page
  const lowerTitle = title.toLowerCase().replace(/\s+/g, '');
  const specialPage = Object.entries(bundleConfig.specialPages).find(
    ([key, _]) => lowerTitle.includes(key)
  );
  
  let contentTypeConfig = bundleConfig.contentTypes[contentType] || bundleConfig.contentTypes.page;
  let useBundle = contentTypeConfig.useBundle;
  let indexFileName = contentTypeConfig.indexFile;
  
  // Override with special page config if applicable
  if (specialPage) {
    const [_, config] = specialPage;
    contentTypeConfig = bundleConfig.contentTypes[config.type];
    
    // Use specialized path
    useBundle = config.useBundle !== undefined ? config.useBundle : contentTypeConfig.useBundle;
    indexFileName = config.indexFile || contentTypeConfig.indexFile;
  }
  
  // Base content directory
  const baseDir = path.join('content', targetFolder);
  
  if (useBundle) {
    // Bundle structure: /content/posts/my-post/index.md
    const bundleDirPath = path.join(baseDir, slug);
    const indexFilePath = path.join(bundleDirPath, indexFileName);
    
    return {
      bundleDirPath,
      indexFilePath,
      slug,
      indexFileName,
      isBundle: true
    };
  } else {
    // Flat structure: /content/posts/my-post.md
    const bundleDirPath = baseDir;
    const indexFilePath = path.join(bundleDirPath, `${slug}.md`);
    
    return {
      bundleDirPath,
      indexFilePath,
      slug,
      indexFileName: `${slug}.md`,
      isBundle: false
    };
  }
}

/**
 * Ensures a bundle directory exists
 */
export function ensureBundleDirectory(bundlePath: BundlePath): void {
  fs.ensureDirSync(bundlePath.bundleDirPath);
}

/**
 * Creates a path for an image within a bundle
 */
export function createBundleImagePath(bundlePath: BundlePath, imageFileName: string): string {
  if (!bundlePath.isBundle) {
    // For flat structure, images go to static/images
    return path.join('static', 'images', imageFileName);
  }
  
  // For bundle structure, images go inside the bundle directory
  return path.join(bundlePath.bundleDirPath, imageFileName);
}
