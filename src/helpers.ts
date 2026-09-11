import { Client, isFullPage } from "@notionhq/client";
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
    if (prop && typeof prop === 'object' && 'type' in prop && prop.type === "title" && 'title' in prop && prop.title && prop.title.length > 0) {
      return prop.title.map((text: any) => text.plain_text).join("");
    }
  }

  // If no title property was found, look for a Name property
  const nameProperty = Object.values(page.properties).find(
    prop => prop && typeof prop === 'object' && 'type' in prop && prop.type === "title"
  );
  
  if (nameProperty && 'title' in nameProperty && nameProperty.title?.length) {
    return nameProperty.title.map((text: any) => text.plain_text).join("");
  }
  
  return "Untitled";
}

export function getPagePublishDate(page: PageObjectResponse): string {
  const publishDateProperty = page.properties["Publish Date"];

  if (
    publishDateProperty &&
    publishDateProperty.type === "date" &&
    publishDateProperty.date
  ) {
    return publishDateProperty.date.start;
  }

  // If publishDateProperty is not defined or is empty, use page.created_time
  return page.created_time;
}

export function getPageShouldBeProcessed(page: PageObjectResponse): boolean {
  // Check if it's a child page first
  if (page.parent.type === "page_id") {
    console.info(
      `[Info] The post ${getPageTitle(page)} is a child page, processing.`,
    );
    return true;
  }

  // For database entries, require Status = "Published"
  if (page.properties) {
    for (const [key, prop] of Object.entries(page.properties)) {
      if (!prop || typeof prop !== 'object' || !('type' in prop)) continue;

      if (key === "Status" || key === "status") {
        if (prop.type === "status" && 'status' in prop) {
          const statusName = (prop as any).status?.name;
          if (statusName === "Published") {
            return true;
          } else {
            console.info(`[Info] The page ${getPageTitle(page)} has status "${statusName}" instead of "Published", skipped.`);
            return false;
          }
        }
        // Handle select-type Status field as well
        if (prop.type === "select" && 'select' in prop) {
          const statusName = (prop as any).select?.name;
          if (statusName === "Published") {
            return true;
          } else {
            console.info(`[Info] The page ${getPageTitle(page)} has status "${statusName}" instead of "Published", skipped.`);
            return false;
          }
        }
      }
    }
  }

  console.info(`[Info] The page ${getPageTitle(page)} has no Status property, skipped.`);
  return false;
}

export async function getCoverLink(
  page_id: string,
  notion: Client,
): Promise<{ link: string; expiry_time: string | null } | null> {
  const page = await notion.pages.retrieve({ page_id });
  if (!isFullPage(page)) return null;
  if (page.cover === null) return null;
  if (page.cover.type === "external")
    return {
      link: page.cover.external.url,
      expiry_time: null,
    };
  else
    return {
      link: page.cover.file.url,
      expiry_time: page.cover.file.expiry_time,
    };
}

/**
 * Simple sleep function for async operations
 * @param ms Number of milliseconds to sleep
 */
export async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function getFileName(title: string, page_id: string): string {
  // Create a slug from the title
  const slug = slugify(title, {
    lower: true,
    strict: true,
    replacement: "-"
  });
  
  // Append the page ID to ensure uniqueness
  return `${slug}-${page_id.replace(/-/g, "")}.md`;
}

/**
 * Get content file with a fallback retrieval method
 * Use this instead of direct imports from file.ts to avoid circular dependencies
 */
export function getContentFileWithFallback(filepath: string): any | null {
  try {
    const { getContentFileByPath } = require('./file');
    return getContentFileByPath(filepath);
  } catch (error) {
    console.error(`[Error] Failed to get content file ${filepath}: ${error}`);
    return null;
  }
}
