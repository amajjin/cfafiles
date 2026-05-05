const { Client } = require('@notionhq/client');
const { NotionToMarkdown } = require('notion-to-md');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const n2m = new NotionToMarkdown({ notionClient: notion });

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function getExtensionFromContentType(contentType) {
  if (!contentType) return '.jpg';

  if (contentType.includes('image/jpeg')) return '.jpg';
  if (contentType.includes('image/png')) return '.png';
  if (contentType.includes('image/webp')) return '.webp';
  if (contentType.includes('image/gif')) return '.gif';
  if (contentType.includes('image/svg')) return '.svg';

  return '.jpg';
}

function makeShortHash(buffer) {
  return crypto.createHash('md5').update(buffer).digest('hex').slice(0, 8);
}

async function downloadImage(url, outputDir, index) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download image: ${url}`);
  }

  const contentType = response.headers.get('content-type');
  const ext = getExtensionFromContentType(contentType);

  const buffer = Buffer.from(await response.arrayBuffer());
  const hash = makeShortHash(buffer);

  const filename = `image-${index}-${hash}${ext}`;
  const outputPath = path.join(outputDir, filename);

  fs.writeFileSync(outputPath, buffer);

  return filename;
}

async function localizeImages(markdown, slug) {
  const imageRegex = /!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g;
  const matches = [...markdown.matchAll(imageRegex)];

  if (matches.length === 0) {
    return markdown;
  }

  const imageDir = path.join('static', 'images', slug);
  ensureDir(imageDir);

  let updatedMarkdown = markdown;
  let imageIndex = 1;

  for (const match of matches) {
    const fullMatch = match[0];
    const altText = match[1] || '';
    const imageUrl = match[2];

    try {
      console.log(`Downloading image for ${slug}: ${imageUrl}`);

      const filename = await downloadImage(imageUrl, imageDir, imageIndex);
      const localUrl = `/images/${slug}/${filename}`;

      const newMarkdownImage = `![${altText}](${localUrl})`;

      updatedMarkdown = updatedMarkdown.replace(fullMatch, newMarkdownImage);

      imageIndex++;
    } catch (error) {
      console.error(`Image download failed for ${imageUrl}`);
      console.error(error.message);
    }
  }

  return updatedMarkdown;
}

function makeSlug(title) {
  return title
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '')
    .toLowerCase();
}

async function sync() {
  const postsDir = path.join('content', 'posts');
  ensureDir(postsDir);

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

    const slug = props.Slug?.rich_text?.[0]?.plain_text || makeSlug(title);

    const filename = language === 'ko' ? `${slug}.ko.md` : `${slug}.md`;

    const mdBlocks = await n2m.pageToMarkdown(page.id);
    const mdResult = n2m.toMarkdownString(mdBlocks);

    let mdContent = typeof mdResult === 'string' ? mdResult : mdResult.parent;

    mdContent = await localizeImages(mdContent, slug);

    const tagStr = tags.map(t => '"' + t.replace(/"/g, '\\"') + '"').join(', ');
    const catStr = categories.map(c => '"' + c.replace(/"/g, '\\"') + '"').join(', ');

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

    fs.writeFileSync(filePath, frontMatter + mdContent);

    console.log('Synced: ' + filename + ' (lang: ' + language + ')');
  }
}

sync().catch(error => {
  console.error(error);
  process.exit(1);
});
