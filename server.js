require('dotenv').config();
const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_API_KEY });

async function testNotion() {
  try {
    // Get page ID from URL: notion.so/PageTitle-abc123def456
    // The ID is the last part after the dash
    const pageId = 'YOUR_PAGE_ID_HERE'; // Paste from your test page URL
    
    const page = await notion.pages.retrieve({ page_id: pageId });
    console.log('✅ Connected to Notion!');
    console.log('Page title:', page.properties?.title || 'No title');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testNotion();
