import { PageObjectResponse } from "@notionhq/client/build/src/api-endpoints";
import slugify from "slugify";

/**
 * Gets the title of a Notion page
 */
export function getPageTitle(page: PageObjectResponse): string {
  if (!page.properties) {
    return "Untitled";
  }
  
  // Look for title property
  for (const [key, prop] of Object.entries(page.properties)) {
    if (prop.type === "title" && prop.title.length > 0) {
      return prop.title.map(text => text.plain_text).join("");
    }
  }

  // If no title property was found, look for a Name property
  const nameProperty = Object.values(page.properties).find(
    prop => prop.type === "title"
  );
  
  if (nameProperty?.title?.length) {
    return nameProperty.title.map((text: any) => text.plain_text).join("");
  }
  
  return "Untitled";
}

/**
 * Generate a filename for a Notion page
 */
export function getFileName(title: string, pageId: string): string {
  // Create a slug from the title
  const slug = slugify(title, {
    lower: true,
    strict: true,
    replacement: "-"
  });
  
  // Append the page ID to ensure uniqueness
  return `${slug}-${pageId.replace(/-/g, "")}.md`;
}

/**
 * Check if a page should be processed based on its Status property
 */
export function getPageShouldBeProcessed(page: PageObjectResponse): boolean {
  // Default to processing the page
  let shouldProcess = true;
  
  // Check for Status property
  if (page.properties) {
    for (const [key, prop] of Object.entries(page.properties)) {
      if (prop.type === "status" && prop.status) {
        const status = prop.status.name.toLowerCase();
        
        // Skip pages that are not ready to be published
        if (status === "draft" || status === "in progress") {
          console.info(`[Info] The post ${getPageTitle(page)} is not ready to be published, skipped.`);
          shouldProcess = false;
          break;
        }
      }
    }
  }
  
  return shouldProcess;
}

/**
 * Get the cover image URL from a page
 */
export function getCoverLink(page: PageObjectResponse): string | null {
  if (!page.cover) return null;
  
  if (page.cover.type === "external") {
    return page.cover.external.url;
  } else if (page.cover.type === "file") {
    return page.cover.file.url;
  }
  
  return null;
}
