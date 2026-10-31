// Copy of real-estate-quest/src/constants/chapters.js. Keep the two lists in sync.
export const chapters = [
  { id: 1, name: "Fundamentals of Law and the Real Estate Services Act" },
  { id: 2, name: "Estates and Interests in Land, The Subdivision of Land, and Title Registration" },
  { id: 3, name: "The Professional Liability of Real Estate Licensees" },
  { id: 4, name: "Commercial and Residential Tenancies and Strata Properties" },
  { id: 5, name: "Financial Statements" },
  { id: 6, name: "Professionalism and Ethics" },
  { id: 7, name: "The Law of Contract" },
  { id: 8, name: "Contracts for Real Estate Transactions and Law of Agency" },
  { id: 9, name: "Introduction to Mortgage Finance" },
  { id: 10, name: "Interest Rates and Mortgages" },
  { id: 11, name: "Introduction to Mortgage Law" },
  { id: 12, name: "Mortgage Analysis in Real Estate Practice" },
  { id: 13, name: "Mortgage Underwriting and Borrower Qualification" },
  { id: 14, name: "Local Government Law and Taxes on Real Property" },
  { id: 15, name: "Building Design and Construction" },
  { id: 16, name: "Introduction to Real Estate Appraisal" },
  { id: 17, name: "Direct Comparison (Comparative) and Cost Approaches of Appraisal" },
  { id: 18, name: "The Income or Investment Approach of Appraisal" },
  { id: 19, name: "From Contract to Completion" },
  { id: 20, name: "Marketing and Technology and the Real Estate Licensee" },
];

export const TOTAL_CHAPTERS = chapters.length;

/**
 * True for an integer chapter number from 1 to TOTAL_CHAPTERS.
 */
export function isValidChapterNumber(value) {
  return Number.isInteger(value) && value >= 1 && value <= TOTAL_CHAPTERS;
}

/**
 * Returns the chapter's name, or throws for an unknown chapter number.
 */
export function getChapterName(chapter) {
  const match = chapters.find((entry) => entry.id === chapter);
  if (!match) throw new Error(`Unknown chapter ${chapter}`);
  return match.name;
}
