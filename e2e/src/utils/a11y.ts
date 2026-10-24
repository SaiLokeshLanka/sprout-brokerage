import AxeBuilder from '@axe-core/playwright';
import { Page } from '@playwright/test';

/** WCAG 2.1 level A and AA: the standard most accessibility laws and audits ask for. */
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/**
 * Runs axe-core on the current page and returns a readable list of problems
 * (empty = no violations), so a failing test says exactly what to fix and where.
 */
export async function accessibilityProblems(page: Page, options: { exclude?: string[] } = {}) {
  let builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  for (const selector of options.exclude ?? []) builder = builder.exclude(selector);
  const { violations } = await builder.analyze();
  return violations.map((v) => ({
    rule: v.id,
    impact: v.impact,
    problem: v.help,
    howToFix: v.helpUrl,
    elements: v.nodes.slice(0, 5).map((n) => n.target.join(' ')),
  }));
}
