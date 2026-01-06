// Quick script to check what properties exist on pages
const { Client } = require('@notionhq/client');
require('dotenv').config();

const notion = new Client({
  auth: process.env.NOTION_TOKEN,
  // Don't specify notionVersion - let it use default for v5
});

async function checkProperties() {
  try {
    const databaseId = '0cb08ce34a92421c8f01a3d2151ce62e';
    
    // Query the database using dataSources API
    const response = await notion.dataSources.query({
      data_source_id: databaseId,
      page_size: 100, // Get all pages
    });
    
    // Find the CBus page
    const cbusPage = response.results.find(page => {
      const title = page.properties.Title?.title?.[0]?.plain_text || 
                   page.properties.Name?.title?.[0]?.plain_text || '';
      return title.includes('CBus MQTT');
    });
    
    if (cbusPage) {
      console.log('\n=== CBUS MQTT BRIDGE PAGE ===\n');
      console.log('All properties and their structure:\n');
      
      for (const [key, value] of Object.entries(cbusPage.properties)) {
        console.log(`${key}:`);
        console.log(JSON.stringify(value, null, 2));
        console.log('---');
      }
    } else {
      console.log('CBus page not found');
    }
  } catch (error) {
    console.error('Error:', error.message);
    if (error.body) {
      console.error('Details:', JSON.stringify(error.body, null, 2));
    }
  }
}

checkProperties();
