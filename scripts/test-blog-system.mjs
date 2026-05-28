import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import ts from '../worker/node_modules/typescript/lib/typescript.js';

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);
const require = createRequire(import.meta.url);
const moduleCache = new Map();

function resolveModule(request, parentFile) {
  if (request.startsWith('.')) {
    const base = path.resolve(path.dirname(parentFile), request);
    for (const candidate of [`${base}.ts`, `${base}.js`, path.join(base, 'index.ts')]) {
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return request;
}

function loadTsModule(file) {
  const abs = path.resolve(file);
  if (moduleCache.has(abs)) return moduleCache.get(abs).exports;
  const source = fs.readFileSync(abs, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
    fileName: abs,
  }).outputText;
  const mod = { exports: {} };
  moduleCache.set(abs, mod);
  const localRequire = (request) => {
    const resolved = resolveModule(request, abs);
    if (resolved.endsWith('.ts')) return loadTsModule(resolved);
    return require(resolved);
  };
  const fn = new Function('require', 'module', 'exports', compiled);
  fn(localRequire, mod, mod.exports);
  return mod.exports;
}

const wordpress = loadTsModule(path.join(repoRoot, 'worker/src/services/wordpress.ts'));
const templates = loadTsModule(path.join(repoRoot, 'worker/src/modules/blog-templates.ts'));
const quality = loadTsModule(path.join(repoRoot, 'worker/src/modules/blog-quality.ts'));
const platform = loadTsModule(path.join(repoRoot, 'worker/src/modules/platform-compatibility.ts'));
const blogImages = loadTsModule(path.join(repoRoot, 'worker/src/modules/blog-body-images.ts'));
const blogPublishing = loadTsModule(path.join(repoRoot, 'worker/src/modules/blog-publishing.ts'));

const activeSlugs = [
  '247-lockout-pasadena',
  '724-locksmith-ca',
  'americas-professional-builders',
  'caliview-builders',
  'caliview-landscape',
  'daniels-locksmith',
  'elite-team-builders',
  'golden-touch-roofing',
  'jaz-makeup-artist',
  'modern-vision-remodeling',
  'unlocked-pros',
  'webxni',
];

assert.deepEqual(templates.getConfiguredActiveClientTemplateSlugs(), activeSlugs);

const landscapingTemplate = templates.resolveBlogTemplateConfig({
  slug: 'caliview-landscape',
  canonical_name: 'Caliview Landscape',
  industry: 'landscaping',
  state: 'CA',
  brand_json: null,
  wp_template_key: null,
  cta_text: null,
});
assert.equal(landscapingTemplate.key, 'landscaping');
assert.match(landscapingTemplate.categoryLabel, /Landscape/i);

const locksmithTemplate = templates.resolveBlogTemplateConfig({
  slug: 'daniels-locksmith',
  canonical_name: "Daniel's Locks & Key",
  industry: 'Locksmith',
  state: 'CA',
  brand_json: null,
  wp_template_key: null,
  cta_text: null,
});
assert.equal(locksmithTemplate.key, 'locksmith');

const blog = {
  title: 'Drought Tolerant Garden Planning in Studio City',
  excerpt: 'A practical guide to planning a drought tolerant garden in Studio City with irrigation, plant zones, and curb appeal in mind.',
  focusKeyword: 'drought tolerant garden Studio City',
  secondaryKeywords: 'Studio City landscape design, water wise garden',
  seoTitle: 'Drought Tolerant Garden Studio City',
  metaDescription: 'Plan a drought tolerant garden in Studio City with practical landscape design steps and local planting guidance.',
  slug: 'drought-tolerant-garden-studio-city',
  intro: 'A drought tolerant garden in Studio City works best when planting, irrigation, and maintenance are planned together.',
  sections: [
    { heading: 'Start With Studio City Site Conditions', html: '<p>Sun exposure, slope, soil, and irrigation access shape the right landscape design plan.</p>' },
    { heading: 'Choose Plants For Low Water Use', html: '<p>Group plants by water needs so the garden stays coherent and easier to maintain.</p>' },
    { heading: 'Plan Irrigation Before Installation', html: '<p>Drip lines, zones, and controller settings should match the planting plan.</p>' },
  ],
  faq: [
    { question: 'How do I plan a drought tolerant garden in Studio City?', answer: 'Start with site conditions, water use, and the look you want before selecting plants.' },
    { question: 'What plants work for low water gardens?', answer: 'Choose climate-appropriate plants that can share similar irrigation zones.' },
  ],
  conclusion: 'A focused landscape plan helps the finished garden look intentional and easier to maintain.',
  ctaHeading: 'Plan Your Garden',
  ctaBody: 'Caliview Landscape can help choose the right next step for your outdoor space.',
  ctaButtonLabel: 'Request Guidance',
};

const html = wordpress.renderStructuredBlogHtml({
  templateKey: landscapingTemplate.key,
  primaryColor: landscapingTemplate.primaryColor,
  accentColor: landscapingTemplate.accentColor,
  clientName: 'Caliview Landscape',
  clientSlug: 'caliview-landscape',
  industry: 'landscaping',
  publishDate: '2026-05-28',
  template: landscapingTemplate,
  bodyImages: {
    slot1: '<img src="https://example.test/garden.webp" alt="Garden"><figcaption>Garden</figcaption>',
  },
  blog,
});

assert.match(html, /data-wx-blog-template="landscaping"/);
assert.match(html, /Keyword Focus/);
assert.match(html, /Quick Information/);
assert.match(html, /Related Services/);
assert.match(html, /loading="lazy"/);
assert.match(html, /object-fit:cover/);
assert.match(html, /data-share-title=/);
assert(!html.includes('<!-- BLOG_BODY_IMAGE_1 -->'));

const duplicateValidation = quality.validateBlogPublishingContent({
  content_type: 'blog',
  title: 'Smart Lock Installation Guide',
  seo_title: 'Smart Lock Installation Guide',
  meta_description: 'Smart lock installation guide for Studio City homes.',
  target_keyword: 'smart lock installation Studio City',
  slug: 'smart-lock-installation-studio-city',
  blog_excerpt: 'Smart lock installation guide for Studio City homes.',
  ai_image_prompt: 'Prompt',
  blog_content: `
    <h2>Smart Lock Planning</h2><p>This duplicate paragraph is intentionally long enough to trigger duplicate paragraph validation in the blog quality check.</p>
    <h2>Smart Lock Planning</h2><p>This duplicate paragraph is intentionally long enough to trigger duplicate paragraph validation in the blog quality check.</p>
    <div class="wx-blog-faq-item"><h3>How does smart lock installation work?</h3><p>Answer one.</p></div>
    <div class="wx-blog-faq-item"><h3>How does smart lock installation work?</h3><p>Answer two.</p></div>
    <img src="https://example.test/a.webp"><img src="https://example.test/a.webp">
  `,
}, {
  clientName: '7/24 Locksmith Services',
  industry: 'Locksmith',
  serviceNames: ['Smart Lock Installation & Setup', 'Lock rekeying'],
  serviceAreas: ['Studio City'],
  categoryNames: ['Locksmith'],
});
assert.equal(duplicateValidation.ok, false);
assert(duplicateValidation.errors.includes('Blog contains duplicate headings'));
assert(duplicateValidation.errors.includes('Blog contains duplicate paragraphs'));
assert(duplicateValidation.errors.includes('Blog contains duplicate FAQ questions'));
assert(duplicateValidation.errors.includes('Blog contains duplicate images'));

const mismatchValidation = quality.validateBlogPublishingContent({
  content_type: 'blog',
  title: 'Kitchen Countertop Planning',
  seo_title: 'Kitchen Countertop Planning',
  meta_description: 'Kitchen countertop planning for homeowners.',
  target_keyword: 'kitchen countertops Pasadena',
  slug: 'kitchen-countertops-pasadena',
  blog_excerpt: 'Kitchen countertop planning for homeowners.',
  ai_image_prompt: 'Prompt',
  blog_content: '<h2>Kitchen Countertop Materials</h2><p>Kitchen countertop remodel planning includes stone, tile, sink access, and bathroom remodel details.</p>',
}, {
  clientName: 'Daniel’s Locks & Key',
  industry: 'Locksmith',
  serviceNames: ['Lock rekeying', 'Door lock repair'],
  serviceAreas: ['Burbank'],
  categoryNames: ['Locksmith'],
});
assert.equal(mismatchValidation.ok, false);
assert(mismatchValidation.errors.some((error) => error.includes('unrelated service families')));

const blogUrl = 'https://example.test/blog/smart-lock-guide/';
const socialCaptions = ['facebook', 'linkedin', 'x', 'threads', 'pinterest', 'google_business'].map((name) => quality.buildBlogSocialCaption({
  platform: name,
  title: 'Studio City Smart Lock Installation Choices',
  excerpt: 'Learn how to compare smart lock options before upgrading home access.',
  clientName: '7/24 Locksmith Services',
  blogUrl,
}));
assert(socialCaptions.every((caption) => caption.includes(blogUrl)));
assert(new Set(socialCaptions).size >= 5);

const distribution = platform.getBlogDistributionPlatforms([
  { platform: 'facebook', paused: 0, connection_status: 'connected' },
  { platform: 'youtube', paused: 0, connection_status: 'connected' },
  { platform: 'tiktok', paused: 0, connection_status: 'connected' },
  { platform: 'linkedin', paused: 0, connection_status: 'connected' },
  { platform: 'instagram', paused: 1, connection_status: 'connected' },
]);
assert.deepEqual(distribution, ['facebook', 'linkedin']);

const imageJson = blogImages.serializeBlogBodyImages([
  {
    slot: 1,
    r2_key: 'client/post/generated-slot1.webp',
    prompt: 'Generated hero prompt',
    wp_media_id: null,
    attempts: 1,
    status: 'generated',
    source: 'ai',
    role: 'hero',
  },
  {
    slot: 2,
    r2_key: 'client/post/uploaded-slot2.webp',
    prompt: '',
    wp_media_id: null,
    attempts: 0,
    status: 'generated',
    source: 'upload',
    role: 'body',
    allow_duplicate: true,
  },
]);
const parsedImages = blogImages.parseBlogBodyImages(imageJson);
assert.equal(parsedImages[0].source, 'ai');
assert.equal(parsedImages[0].role, 'hero');
assert.equal(parsedImages[1].source, 'upload');
assert.equal(parsedImages[1].allow_duplicate, true);

const generatedFeatured = blogPublishing.resolveBlogSocialImage({
  asset_r2_key: null,
  asset_r2_bucket: null,
  blog_body_images: imageJson,
});
assert.deepEqual(generatedFeatured, { r2Key: 'client/post/generated-slot1.webp', bucket: 'MEDIA', source: 'slot1' });

const uploadedFeatured = blogPublishing.resolveBlogSocialImage({
  asset_r2_key: 'client/post/uploaded-featured.jpg',
  asset_r2_bucket: 'MEDIA',
  blog_body_images: imageJson,
});
assert.deepEqual(uploadedFeatured, { r2Key: 'client/post/uploaded-featured.jpg', bucket: 'MEDIA', source: 'featured' });

assert.equal(blogImages.findDuplicateBlogImageSlot(parsedImages, 'client/post/generated-slot1.webp', 2), 1);
assert.equal(blogImages.findDuplicateBlogImageSlot(parsedImages, 'client/post/uploaded-slot2.webp', 1), null);

console.log('Blog system tests passed');
