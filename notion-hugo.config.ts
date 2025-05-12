import { UserConfig } from "./src/config"

/**
 * Notion-Hugo Configuration
 * 
 * This configuration supports both direct settings and environment variables.
 * When deployed via Docker, the environment variables will override these settings.
 */
const userConfig: UserConfig = {
    mount: {
        manual: false,
        // Use environment variable or fallback to default
        page_url: process.env.NOTION_PAGE_URL || 'https://www.notion.so/Content-Management-252a519e13ee46c5b576691e1026e7e0',
        pages: [
            // Default configuration if no env vars are provided
            {
                page_id: '42464b089a234424a6396c013fa6cef6',
                target_folder: '.'
            }
        ],
        databases: [
            // Default configuration if no env vars are provided
            {
                database_id: '4bb8f075358d4efeb575192baa1d62b9',
                target_folder: '.'
            }
        ],
    }
}

// Process environment variables if provided
if (process.env.NOTION_PAGE_IDS) {
    const pageIds = process.env.NOTION_PAGE_IDS.split(',');
    userConfig.mount.pages = pageIds.map(item => {
        const [page_id, target_folder] = item.split(':');
        return { page_id, target_folder };
    });
}

if (process.env.NOTION_DATABASE_IDS) {
    const databaseIds = process.env.NOTION_DATABASE_IDS.split(',');
    userConfig.mount.databases = databaseIds.map(item => {
        const [database_id, target_folder] = item.split(':');
        return { database_id, target_folder };
    });
}

export default userConfig;
