const { Client } = require('@notionhq/client');
const { NotionToMarkdown } = require('notion-to-md');
const fs = require('fs');
const path = require('path');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const n2m = new NotionToMarkdown({ notionClient: notion });

async function sync() {
  const postsDir = path.join('content', 'posts');
  fs.mkdirSync(postsDir, { recursive: true });

  const response = await notion.databases.query({
    database_id: process.env.NOTION_DATABASE_ID,
    filter: {
      property: 'Status',
      select: { equals: 'Published' }
    }
  });

  console.log('Found ' + response.results.length + ' published pages');

  for (const page of response.results) {
    const props = page.properties;

    const title = props.Title?.title?.[0]?.plain_text || 'Untitled';
    const date = props.Date?.date?.start || new Date().toISOString().split('T')[0];
    const tags = props.Tags?.multi_select?.map(t => t.name) || [];
    const categories = props.Categories?.multi_select?.map(c => c.name) || [];
    const rawLanguage = props.Language?.select?.name || 'en';

    const languageMap = {
      en: 'en',
      english: 'en',
      English: 'en',
      ko: 'ko',
      korean: 'ko',
      Korean: 'ko',
      한국어: 'ko'
    };

    const language = languageMap[rawLanguage] || 'en';

    const slug = props.Slug?.rich_text?.[0]?.plain_text ||
      title.replace(/\s+/g, '-').replace(/[^\p{L}\p{N}-]/gu, '').toLowerCase();

    const filename = language === 'ko' ? `${slug}.ko.md` : `${slug}.md`;

    const mdBlocks = await n2m.pageToMarkdown(page.id);
    const mdContent = n2m.toMarkdownString(mdBlocks);

    const tagStr = tags.map(t => '"' + t + '"').join(', ');
    const catStr = categories.map(c => '"' + c + '"').join(', ');

    const frontMatter = [
      '---',
      'title: "' + title.replace(/"/g, '\\"') + '"',
      'date: ' + date,
      'draft: false',
      'tags: [' + tagStr + ']',
      'categories: [' + catStr + ']',
      'language: "' + language + '"',
      '---',
      ''
    ].join('\n');

    const filePath = path.join(postsDir, filename);

    fs.writeFileSync(filePath, frontMatter + mdContent.parent);

    console.log('Synced: ' + filename + ' (lang: ' + language + ')');
  }
}

sync().catch(error => {
  console.error(error);
  process.exit(1);
});
