/**
 * Public re-export of the translations module.
 * All locale dictionaries live in ./translations/ (pt.ts, es.ts, index.ts).
 * Import from here for backward compatibility with existing call sites.
 */
export { translations, getStaticTranslation } from "./translations/index";
