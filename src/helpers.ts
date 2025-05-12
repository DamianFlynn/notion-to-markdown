import { Client, isFullPage } from "@notionhq/client";
import { PageObjectResponse } from "@notionhq/client/build/src/api-endpoints";

export function getPageTitle(page: PageObjectResponse): string {
  const title = page.properties.Name ?? page.properties.title;
  if (title.type === "title") {
    return title.title.map((text) => text.plain_text).join("");
  }
  throw Error(
    `page.properties.Name has type ${title.type} instead of title. The underlying Notion API might has changed, please report an issue to the author.`,
  );
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
  if (page.parent.type === "page_id") {
    console.info(
      `[Info] The post ${getPageTitle(page)} is a child page, processing.`,
    );
    return true;
  }
  // The page is a database page, lets check its publishing status
  const statusProperty = page.properties.Status;

  // Check if statusProperty is defined
  if (
    statusProperty &&
    statusProperty.type === "status" &&
    statusProperty.status
  ) {
    const statusName = statusProperty.status.name;
    if (statusName !== "Published" && statusName !== "Draft") {
      console.info(
        `[Info] The post ${getPageTitle(page)} is not ready to be published, skipped.`,
      );
      return false;
    }
    return true;
  }

  // If statusProperty is not defined, default to processing the page
  console.info(
    `[Info] The post ${getPageTitle(page)} has no Status property, processing as default.`,
  );
  return true;
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
  return (
    title.replaceAll(" ", "-").replace(/--+/g, "-") +
    "-" +
    page_id.replaceAll("-", "") +
    ".md"
  );
}
