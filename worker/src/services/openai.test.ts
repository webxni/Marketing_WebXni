import { describe, expect, it } from 'vitest';
import {
  buildGenerationRequest,
  buildBlogContentHtml,
  canonicalizeGeneratedPhoneNumbers,
  normalizeGeneratedMarketingCliches,
  normalizeGeneratedUnverifiedClaims,
  findRestrictedContentPhrase,
  isGeneratedCaptionField,
  normalizeGeneratedCaptionValue,
  validateGeneratedContent,
  type GenerationContext,
} from './openai';

const socialContext: GenerationContext = {
  client: { canonical_name: 'Daniel\'s Locks & Key', industry: 'Locksmith', state: 'CA', phone: '(323) 555-0100' },
  intelligence: null,
  recentTitles: [],
  feedback: [],
  publishDate: '2026-08-05',
  contentType: 'image',
  platforms: ['facebook', 'instagram'],
  serviceAreas: ['Hollywood'],
  serviceNames: ['Residential Rekeying'],
  targetKeywords: ['residential locksmith Hollywood'],
  topicResearch: {
    topic: 'How residential rekeying changes access after a move',
    angle: 'Explain the practical access-control decision.',
    format: 'process_breakdown',
    targetKeyword: 'residential locksmith Hollywood',
    localModifier: 'Hollywood',
    searchQuestion: 'How does residential rekeying work after moving in Hollywood?',
  },
  highQuality: true,
};

const blogContext: GenerationContext = {
  ...socialContext,
  contentType: 'blog',
  platforms: ['website_blog'],
};

describe('generated caption normalization', () => {
  it('keeps plain captions unchanged after trimming', () => {
    expect(normalizeGeneratedCaptionValue('  Call today for a free estimate.  ')).toBe('Call today for a free estimate.');
  });

  it('extracts public copy from structured caption JSON strings', () => {
    const raw = JSON.stringify({
      post_type: 'STANDARD',
      body: 'Pasadena homeowners can refresh outdoor spaces with expert hardscape planning.',
      cta_type: 'CALL',
      designer_prompt_es: 'Crear una imagen horizontal de un patio moderno.',
    });

    expect(normalizeGeneratedCaptionValue(raw)).toBe(
      'Pasadena homeowners can refresh outdoor spaces with expert hardscape planning.',
    );
  });

  it('extracts public copy from structured caption objects', () => {
    expect(normalizeGeneratedCaptionValue({
      caption: 'Protect your remodel timeline with early permit planning.',
      review_notes: 'Public copy is in caption.',
    })).toBe('Protect your remodel timeline with early permit planning.');
  });

  it('recognizes all persisted social caption fields', () => {
    expect(isGeneratedCaptionField('cap_gbp_la')).toBe(true);
    expect(isGeneratedCaptionField('cap_google_business')).toBe(true);
    expect(isGeneratedCaptionField('ai_image_prompt')).toBe(false);
  });

  it('requires SEO keyword and locality metadata for social generation', () => {
    const schema = buildGenerationRequest(socialContext).schema.schema as { required: string[] };
    expect(schema.required).toContain('target_keyword');
    expect(schema.required).toContain('target_locality');
  });

  it('uses the documented horizontal format for multi-platform images', () => {
    const prompt = buildGenerationRequest(socialContext).prompt;
    expect(prompt).toContain('1200x628');
    expect(prompt).toContain('service-specific calls to action');
    expect(prompt).not.toContain('immediate help');
    expect(prompt).toContain('universal procedure');
  });

  it('places client restrictions in the generation brief', () => {
    const prompt = buildGenerationRequest({
      ...socialContext,
      restrictions: ['NEVER mention car key fob', 'car key programming under any circumstance ever'],
    }).prompt;
    expect(prompt).toContain('CLIENT RESTRICTIONS (mandatory)');
    expect(prompt).toContain('NEVER mention car key fob');
  });

  it('keeps editorial feedback concise in later generation briefs', () => {
    const prompt = buildGenerationRequest({
      ...socialContext,
      feedback: [{
        sentiment: 'negative',
        note: `Do not repeat the rejected service angle. ${'Repeated detail '.repeat(100)}TAIL_MARKER`,
      }],
    }).prompt;
    expect(prompt).toContain('Do not repeat the rejected service angle.');
    expect(prompt).not.toContain('TAIL_MARKER');
  });

  it('does not request or render a designer asset for blog slots', () => {
    const request = buildGenerationRequest(blogContext);
    const schema = request.schema.schema as { properties: Record<string, unknown> };
    expect(schema.properties).not.toHaveProperty('ai_image_prompt');
    expect(request.prompt).not.toContain('featured image brief');

    const html = buildBlogContentHtml({
      title: 'Residential Locksmith Hollywood Access Guide',
      blog_excerpt: 'A practical guide to residential access decisions in Hollywood.',
      target_keyword: 'residential locksmith Hollywood',
      intro: 'Moving into a Hollywood home changes who may still have working keys and which doors need attention.',
      sections: [
        { heading: 'Residential locksmith Hollywood access review', html: '<p>Start by identifying every exterior entry point.</p>' },
        { heading: 'Decide which keys should keep working', html: '<p>Separate household access from vendor or temporary access.</p>' },
        { heading: 'Document the final access plan', html: '<p>Record who receives each new key after the work is complete.</p>' },
      ],
      faq: [],
    }, blogContext.client, blogContext.publishDate);

    expect(html).not.toBeNull();
    expect(html).not.toContain('<style');
  });

  it('rejects a designer prompt with the wrong asset dimensions', () => {
    const quality = validateGeneratedContent({
      title: 'How Rekeying Changes Access After a Hollywood Move',
      master_caption: 'A residential locksmith Hollywood homeowners call can rekey a home so old keys no longer control access.',
      target_keyword: 'residential locksmith Hollywood',
      target_locality: 'Hollywood',
      ai_image_prompt: 'Crear una imagen cuadrada de 1080x1080 para redes sociales.',
    }, socialContext);
    expect(quality.passed).toBe(false);
    expect(quality.warnings).toContain('designer prompt must specify 1200x628 for image');
  });

  it('rejects recycled titles and missing exact SEO metadata', () => {
    const quality = validateGeneratedContent({
      title: 'Before You Hire a Residential Locksmith',
      master_caption: 'Hollywood residents can use residential rekeying to control who has keys after a move.',
      target_keyword: 'residential locksmith',
      target_locality: 'Los Angeles',
    }, socialContext);
    expect(quality.passed).toBe(false);
    expect(quality.warnings.some((warning) => warning.startsWith('generic pattern:'))).toBe(true);
    expect(quality.warnings).toContain('target_keyword must exactly match selected keyword: "residential locksmith Hollywood"');
    expect(quality.warnings).toContain('target_locality must exactly match one confirmed area: Hollywood');
  });

  it('rejects generic authority claims in titles', () => {
    const quality = validateGeneratedContent({
      title: 'Trusted Residential Locksmith in Hollywood',
      master_caption: 'A residential locksmith Hollywood homeowners call can explain how rekeying changes access after a move.',
      target_keyword: 'residential locksmith Hollywood',
      target_locality: 'Hollywood',
    }, socialContext);
    expect(quality.passed).toBe(false);
    expect(quality.warnings.some((warning) => warning.includes('^trusted'))).toBe(true);
  });

  it('rejects leading numbered detail-list titles', () => {
    const quality = validateGeneratedContent({
      title: '3 Details That Decide Your Hollywood Rekey Plan',
      master_caption: 'A residential locksmith Hollywood homeowners call can explain how rekeying changes access after a move.',
      target_keyword: 'residential locksmith Hollywood',
      target_locality: 'Hollywood',
    }, socialContext);
    expect(quality.passed).toBe(false);
    expect(quality.warnings.some((warning) => warning.includes('details|checks|questions|things|tips'))).toBe(true);
  });

  it('canonicalizes generated phone numbers to the verified client phone', () => {
    const post = {
      title: 'Hollywood Rekeying',
      master_caption: 'Call 818-555-0199 to discuss residential rekeying in Hollywood.',
      cap_instagram: 'Call (818) 555-0199 for help.',
      ai_image_prompt: 'Texto: ((818) 555-0199',
    };
    canonicalizeGeneratedPhoneNumbers(post, '(323) 555-0100');
    expect(post.master_caption).toContain('(323) 555-0100');
    expect(post.cap_instagram).toBe('Call (323) 555-0100 for help.');
    expect(post.ai_image_prompt).toContain('(323) 555-0100');
    expect(post.ai_image_prompt).not.toContain('((');
  });

  it('rewrites canned marketing phrases before quality validation', () => {
    const post = {
      title: 'Hollywood Rekeying With Expert Guidance',
      master_caption: 'Call for immediate help from a trusted service.',
      blog_content: '<p>For immediate help, describe the lock and location.</p>',
      target_keyword: 'residential locksmith Hollywood',
      target_locality: 'Hollywood',
    };

    normalizeGeneratedMarketingCliches(post, 'Locksmith');

    expect(post.title).toContain('Practical guidance');
    expect(post.master_caption).toBe('Call for locksmith assistance from a professional service.');
    expect(post.blog_content).toContain('For locksmith assistance');
    expect(validateGeneratedContent(post, socialContext).warnings.some((warning) => warning.startsWith('generic pattern:'))).toBe(false);
  });

  it('rejects malformed verified phone formatting', () => {
    const quality = validateGeneratedContent({
      title: 'Hollywood Rekeying After a Move',
      master_caption: 'A residential locksmith Hollywood homeowners call can explain how rekeying changes access. Call ((323) 555-0100.',
      target_keyword: 'residential locksmith Hollywood',
      target_locality: 'Hollywood',
      ai_image_prompt: 'IMAGE HORIZONTAL 1200x628. Texto: ((323) 555-0100.',
    }, socialContext);
    expect(quality.passed).toBe(false);
    expect(quality.warnings).toContain('malformed phone: use the exact client phone (323) 555-0100');
  });

  it('does not treat dates and other shorter numeric references as phone mismatches', () => {
    const quality = validateGeneratedContent({
      title: 'Hollywood Rekeying After a Move',
      master_caption: 'A residential locksmith Hollywood homeowners call can explain rekeying after a move-in inspection dated 2026-08-03.',
      target_keyword: 'residential locksmith Hollywood',
      target_locality: 'Hollywood',
    }, socialContext);

    expect(quality.warnings.some((warning) => warning.startsWith('phone mismatch:'))).toBe(false);
  });

  it('rewrites license claims only when the client profile does not verify them', () => {
    const unverified = {
      title: 'Licensed Contractor Planning in Hollywood',
      master_caption: 'A licensed contractor can explain the permit sequence.',
    };
    normalizeGeneratedUnverifiedClaims(unverified, 'Professional construction and permit planning.');
    expect(unverified.title).toBe('Professional Contractor Planning in Hollywood');
    expect(unverified.master_caption).toContain('A professional contractor');

    const verified = {
      title: 'Licensed Contractor Planning in Hollywood',
      master_caption: 'Verified client profile copy.',
    };
    normalizeGeneratedUnverifiedClaims(verified, 'California license number 123456.');
    expect(verified.title).toContain('Licensed Contractor');
  });

  it('matches restricted service language across reprogramming variants', () => {
    expect(findRestrictedContentPhrase(
      'Car digital and remote key reprogramming in Hollywood',
      ['car key programming under any circumstance ever'],
    )).toBe('car key programming');
  });

  it('blocks ambiguous key-fob topics when automotive fobs are forbidden', () => {
    expect(findRestrictedContentPhrase(
      'New key fob creation Pasadena',
      ['NEVER mention car key fob'],
    )).toBe('key fob');
  });

  it('rejects client-restricted copy and visual phone overlays', () => {
    const quality = validateGeneratedContent({
      title: 'Car Remote Reprogramming in Hollywood',
      master_caption: 'Car digital key reprogramming in Hollywood requires a vehicle-specific check.',
      target_keyword: 'car key programming Hollywood',
      target_locality: 'Hollywood',
      ai_image_prompt: 'IMAGE HORIZONTAL 1200x628. Texto: (323) 555-0100.',
    }, {
      ...socialContext,
      restrictions: ['car key programming under any circumstance ever', 'No phone number in images'],
    });
    expect(quality.warnings).toContain('restricted client content: "car key programming"');
    expect(quality.warnings).toContain('restricted client content: phone number in visual prompt');
  });

  it('rejects hashtags in restricted Google Business captions', () => {
    const quality = validateGeneratedContent({
      title: 'Hollywood Rekeying After a Move',
      master_caption: 'A residential locksmith Hollywood homeowners call can explain how rekeying changes access.',
      cap_google_business: 'Residential rekeying in Hollywood. #Locksmith',
      target_keyword: 'residential locksmith Hollywood',
      target_locality: 'Hollywood',
      ai_image_prompt: 'IMAGE HORIZONTAL 1200x628.',
    }, {
      ...socialContext,
      platforms: ['google_business'],
      restrictions: ['No hashtags on Google'],
    });
    expect(quality.warnings).toContain('restricted client content: hashtag in Google Business caption');
  });

  it('rejects unverified licensing and generic expert-answer copy', () => {
    const quality = validateGeneratedContent({
      title: 'Pasadena Rekeying: Expert Answers',
      master_caption: 'Our licensed professionals provide expert guidance for residential rekeying in Hollywood.',
      target_keyword: 'residential locksmith Hollywood',
      target_locality: 'Hollywood',
    }, socialContext);
    expect(quality.passed).toBe(false);
    expect(quality.warnings).toContain('unsupported claim: license');
    expect(quality.warnings.some((warning) => warning.includes('expert answers'))).toBe(true);
  });
});
