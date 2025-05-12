"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const userConfig = {
    mount: {
        manual: false,
        page_url: 'https://www.notion.so/Content-Management-252a519e13ee46c5b576691e1026e7e0',
        // page_url: 'https://www.notion.so/Notion-DoIt-b4a946f2fdf94cfebe1a425cd87582da',
        pages: [
            // {
            //     page_id: '<page_id>',
            //     target_folder: 'path/relative/to/content/folder'
            // }
            // Get Page ID from URL
            // https://www.notion.so/About-Me-42464b089a234424a6396c013fa6cef6
            // https://www.notion.so/<page_name>-<page_id>
            // <page_id> is the page ID.
            {
                // About Page
                page_id: '42464b089a234424a6396c013fa6cef6',
                // page_id: 'f0d707c254654346b1d7c49078ac74a7',
                target_folder: '.'
            }
        ],
        databases: [
            // {
            //     database_id: '<database_id>',
            //     target_folder: 'path/relative/to/content/folder'
            // }
            // Get Database ID from URL
            // https://www.notion.so/4bb8f075358d4efeb575192baa1d62b9?v=3f363ced63f04f54977e2c0c84b482ee
            // https://www.notion.so/<long_hash_1>?v=<long_hash_2>
            // <long_hash_1> is the database ID and <long_hash_2> is the view ID.
            {
                // Notion 'Posts' Database
                database_id: '4bb8f075358d4efeb575192baa1d62b9',
                // database_id: '68e960d6f53043819afb6df687714cab',
                target_folder: '.'
            }
        ],
    }
};
exports.default = userConfig;
//# sourceMappingURL=notion-hugo.config.js.map