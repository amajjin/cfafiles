const { Client } = require('@notionhq/client');
const { NotionToMarkdown } = require('notion-to-md');
const fs = require('fs');
const path = require('path');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const n2m = new NotionToMarkdown({ notionClient: notion });

// Hugo shortcode 안에서 따옴표가 깨지지 않게 처리
function escapeShortcode(value) {
  if (!value) return '';
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, ' ');
}

// Notion 이미지 블록을 DoIt 테마 image shortcode로 변환
n2m.setCustomTransformer('image', async (block) => {
  const image = block.image;

  let imageUrl = '';

  if (image.type === 'external') {
    imageUrl = image.external.url;
  } else if (image.type === 'file') {
    imageUrl = image.file.url;
  }

  const caption = image.caption
    ? image.caption.map((item) => item.plain_text).join('')
    : '';

  const safeUrl = escapeShortcode(imageUrl);
  const safeCaption = escapeShortcode(caption);
  const alt = safeCaption || 'image';

  if (safeCaption) {
    return `{{< image src="${safeUrl}" alt="${alt}" caption="${safeCaption}" >}}`;
  }

  return `{{< image src="${safeUrl}" alt="${alt}" >}}`;
});

async function sync() {
  const response = await notion.databases.query({
    database_id: process.env.NOTION_DATABASE_ID,
    filter: {
      property: 'Status',
      select: { equals: 'Published' }
    }
  });

  console.log('Found ' + response.results.length + ' published pages');

  fs.mkdirSync(path.join('content', 'posts'), { recursive: true });

  for (const page of response.results) {
    const props = page.properties;

    const title = props.Title?.title?.[0]?.plain_text || 'Untitled';

    const date =
      props.Date?.date?.start ||
      new Date().toISOString().split('T')[0];

    const tags =
      props.Tags?.multi_select?.map((t) => t.name) || [];

    const categories =
      props.Categories?.multi_select?.map((c) => c.name) || [];

    const slug =
      props.Slug?.rich_text?.[0]?.plain_text ||
      title
        .replace(/\s+/g, '-')
        .replace(/[^\p{L}\p{N}-]/gu, '')
        .toLowerCase();

    const mdBlocks = await n2m.pageToMarkdown(page.id);
    const mdContent = n2m.toMarkdownString(mdBlocks);

    const tagStr = tags.map((t) => '"' + t + '"').join(', ');
    const catStr = categories.map((c) => '"' + c + '"').join(', ');

    const frontMatter =
      '---\n' +
      'title: "' + title.replace(/"/g, '\\"') + '"\n' +
      'date: ' + date + '\n' +
      'draft: false\n' +
      'lightgallery: true\n' +
      'tags: [' + tagStr + ']\n' +
      'categories: [' + catStr + ']\n' +
      '---\n\n';

    const filePath = path.join('content', 'posts', slug + '.md');

    fs.writeFileSync(filePath, frontMatter + mdContent.parent);

    console.log('Synced: ' + slug + '.md');
  }
}

sync().catch((error) => {
  console.error(error);
  process.exit(1);
});
