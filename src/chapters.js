// The app's 20 chapters. The names are a copy of real-estate-quest/src/constants/chapters.js: keep the two in sync.
// manualChapters are the chapters of the UBC Real Estate Trading Services Licensing Course Manual (2024 edition) that
// each app chapter covers, with the manual's table of contents headings as topics. The manual has 26 chapters, so
// some app chapters combine two. The headings of manual chapters 13 and 14 (app chapters 9 and 10) still need adding.
export const chapters = [
  {
    id: 1,
    name: "Fundamentals of Law and the Real Estate Services Act",
    manualChapters: [
      {
        number: 1,
        title: "Fundamentals of Law",
        topics: [
          "The Sources of Our Laws",
          "Categories Within Our Legal System",
          "Real Property Law",
          "The Judicial System in Practice: The British Columbia Court System",
        ],
      },
      {
        number: 2,
        title: "The Real Estate Services Act",
        topics: [
          "Requirements for Licensing",
          "Importance of Agency Law in Providing Real Estate Services",
          "The Regulatory and Licensing Body – BC Financial Services Authority",
          "The Real Estate Foundation, the Errors and Omissions Insurance Corporation, and the Compensation Fund Corporation",
          "Other Real Estate Related Organizations",
          "Licensing System",
          "Property Management Conducted by Trading Services Licensees",
          "Trust Accounts",
          "A Closer Look at the Rules",
          "Discipline and Enforcement",
          "The Real Estate Development Marketing Act",
        ],
      },
    ],
  },
  {
    id: 2,
    name: "Estates and Interests in Land, The Subdivision of Land, and Title Registration",
    manualChapters: [
      {
        number: 3,
        title: "What the Purchaser Buys: Estates and Interests in Land",
        topics: [
          "The Evolution of Real Property Law and the Doctrine of Estates",
          "Fee Simple Estate",
          "Life Estate and Estate Pur Autre Vie",
          "Leasehold Estates",
          "Interests in Land Less Than Estates",
          "The Extent of “Ownership” in Land",
          "Co-Ownership of Land",
          "Introduction to Tort Law",
          "Form A – Freehold Transfer",
        ],
      },
      {
        number: 4,
        title: "The Subdivision of Land and Title Registration in British Columbia",
        topics: [
          "Who Owns the Land?",
          "How is Land Divided?",
          "How a Strata Development is Created",
          "Types of Strata Property",
          "Title Registration in British Columbia",
          "The Torrens System of Land Registration",
          "Land Title Offices, Searching Title, and the Registration Process",
          "First Nations Land Registration",
          "Contaminated Sites",
          "Manufactured Homes",
          "Sample Strata Plan Excerpts",
          "Sample Land Title Search",
        ],
      },
    ],
  },
  {
    id: 3,
    name: "The Professional Liability of Real Estate Licensees",
    manualChapters: [
      {
        number: 5,
        title: "The Professional Liability of Real Estate Licensees",
        topics: [
          "Common Grounds of Liability Against Licensees",
          "Negligence",
          "Misrepresentations and Deceit",
          "Errors in Drafting Agreements",
          "Breach of Fiduciary Duty",
          "Statutory and Industry Liability",
          "What is the Bottom Line?",
          "Proceeds of Crime (Money Laundering) and Terrorist Financing Obligations",
          "Key Compliance Obligations under the PCMLTFA",
          "Protecting Against Impacts of Climate Change",
        ],
      },
    ],
  },
  {
    id: 4,
    name: "Commercial and Residential Tenancies and Strata Properties",
    manualChapters: [
      {
        number: 6,
        title: "Commercial and Residential Tenancies",
        topics: [
          "Nature of the Relationship",
          "Residential Tenancy Arbitrations",
          "The Key Rights and Obligations of the Parties in a Tenancy Relationship",
        ],
      },
      {
        number: 7,
        title: "Strata Properties (Condominiums) and Cooperatives in British Columbia",
        topics: [
          "The Strata Corporation",
          "How a Strata Corporation is Governed",
          "Finances",
          "Bylaws and Rules",
          "Repairs",
          "Legal Proceedings",
          "Leasehold Stratas",
          "Strata Titles Compared with Cooperative Corporations",
          "Strata Property Act Form B – Information Certificate",
          "Strata Property Act Form F – Certificate of Payment",
          "Strata Property Act Form K – Notice of Tenant’s Responsibilities",
        ],
      },
    ],
  },
  {
    id: 5,
    name: "Financial Statements",
    manualChapters: [
      {
        number: 8,
        title: "Financial Statements",
        topics: [
          "Forms of Organization",
          "Importance of Financial Reporting",
          "Generally Accepted Accounting Principles (GAAP)",
          "Financial Statements",
          "Income Tax Return",
          "Analyzing Financial Statements",
        ],
      },
    ],
  },
  {
    id: 6,
    name: "Professionalism and Ethics",
    manualChapters: [
      {
        number: 9,
        title: "Professionalism and Ethics",
        topics: [
          "Professions, Professionals, and Professionalism",
          "Ethics",
          "The Regulation of a Profession",
          "Regulating in the Public Interest",
          "Trust",
          "How Honesty and Integrity Relates to Trust",
          "Honesty",
          "Duties to Clients",
          "Duties to Third Parties",
          "Disclosure",
          "The Duty to Report Misconduct",
          "Handling Reports of Misconduct as a Managing Broker",
          "Ethical Codes Outside of RESA and the Rules",
        ],
      },
    ],
  },
  {
    id: 7,
    name: "The Law of Contract",
    manualChapters: [
      {
        number: 10,
        title: "The Law of Contract",
        topics: [
          "Void, Illegal, Voidable and Unenforceable Contracts",
          "Offer",
          "Acceptance",
          "Consideration",
          "Legal Intention",
          "Capacity",
          "Legal Object",
          "Genuine Consent",
          "Termination of a Contract",
          "Remedies",
        ],
      },
    ],
  },
  {
    id: 8,
    name: "Contracts for Real Estate Transactions and Law of Agency",
    manualChapters: [
      {
        number: 11,
        title: "Contracts for Real Estate Transactions",
        topics: [
          "The Requirement of Writing",
          "Listing Contracts",
          "Contract of Purchase and Sale",
          "Effective Contract Negotiation",
          "Risk Management for Licensees",
          "Sample Listing Contract",
          "Property Disclosure Statement",
        ],
      },
      {
        number: 12,
        title: "Law of Agency",
        topics: [
          "The Agency Relationship",
          "Real Estate Agency in British Columbia",
          "Capacity to Act as an Agent",
          "Agent’s Appointment and Authority",
          "Termination of Authority",
          "Relationship Between the Agent and the Third Party",
          "The Duties of the Agent to the Principal",
          "The Duties of the Principal to the Agent",
          "Agency Disclosure in British Columbia",
          "Buyer’s Agency Exclusive Contract",
          "Buyer Agency Acknowledgement",
          "Agreement Regarding Conflict of Interest Between Clients Form",
          "Disclosure of Representation in Trading Services Form",
          "Disclosure of Risks to Unrepresented Parties Form",
          "Disclosure for Residential Tenancies Form",
        ],
      },
    ],
  },
  { id: 9, name: "Introduction to Mortgage Finance", manualChapters: [] },
  { id: 10, name: "Interest Rates and Mortgages", manualChapters: [] },
  {
    id: 11,
    name: "Introduction to Mortgage Law",
    manualChapters: [
      {
        number: 15,
        title: "Introduction to Mortgage Law",
        topics: [
          "Introduction to Mortgage Law",
          "Legal and Equitable Mortgages",
          "Implied Terms of a Mortgage",
          "Express Terms of a Mortgage",
          "Special Types of Mortgages",
          "Federal Legislation over Mortgages",
          "Provincial Legislation over Mortgages",
          "Assignment of the Mortgage",
          "Assumption of the Mortgage",
          "Novation",
          "Priorities",
          "Further Advances",
          "The Foreclosure Process in British Columbia",
          "Agreements for Sale",
          "Form B – Mortgage",
        ],
      },
    ],
  },
  {
    id: 12,
    name: "Mortgage Analysis in Real Estate Practice",
    manualChapters: [
      {
        number: 16,
        title: "Mortgage Analysis in Real Estate Practice",
        topics: [
          "Impact of Financing on Real Estate Transactions",
          "Portable Mortgages",
          "Impact of Brokerage and Other Fees",
          "Prepayment Penalties",
        ],
      },
    ],
  },
  {
    id: 13,
    name: "Mortgage Underwriting and Borrower Qualification",
    manualChapters: [
      {
        number: 17,
        title: "Mortgage Underwriting and Borrower Qualification",
        topics: [
          "Residential (Owner-Occupied) Mortgage Underwriting",
          "Financial Covenants of the Borrower",
          "Advancing the Loan and Collection of Payments",
          "Commercial Mortgage Loan Underwriting",
        ],
      },
    ],
  },
  {
    id: 14,
    name: "Local Government Law and Taxes on Real Property",
    manualChapters: [
      {
        number: 18,
        title: "Local Government Law",
        topics: [
          "The Three Levels of Government",
          "The Rationale for the Regulatory System",
          "The Planning Process",
          "Official Community Plans",
          "Rural Land Use Bylaws",
          "Zoning",
          "Land Use Contracts",
          "Non-Conforming Use",
          "Board of Variance",
          "Permits",
          "Subdivision",
          "Building Bylaws and Inspection",
          "Licensing Bylaws",
          "Sample Zoning Bylaw Extract",
        ],
      },
      {
        number: 19,
        title: "Taxes on Real Property",
        topics: [
          "Taxes on the Purchase or Sale of Real Property",
          "Taxes Paid While Holding Real Property",
          "Sample Property Assessment Notice",
          "Sample Property Tax Notice",
        ],
      },
    ],
  },
  {
    id: 15,
    name: "Building Design and Construction",
    manualChapters: [
      {
        number: 20,
        title: "Building Design and Construction",
        topics: [
          "Current Building Standards",
          "Metric Construction Modules",
          "Architectural Information",
          "Multi-Family Building Construction",
          "Building Systems",
          "Interior Finishes",
          "Inspecting Multi-Family Properties",
          "Residential Housing Classifications",
          "Green Housing: Energy Efficiency and Sustainable Real Estate",
          "Building Measurement Guidelines",
          "Measurement Practices Bulletin CP-15",
        ],
      },
    ],
  },
  {
    id: 16,
    name: "Introduction to Real Estate Appraisal",
    manualChapters: [
      {
        number: 21,
        title: "Introduction to Real Estate Appraisal",
        topics: [
          "The Appraisal Process",
          "Step 1: Defining the Appraisal Problem",
          "Step 2: Scope of Work Determination",
          "Step 3: Data Collection",
          "Step 4: Data Analysis",
          "Step 5: Selection of the Appropriate Appraisal Approach",
          "Step 6: Reconciliation of Value Indications and Final Opinion of Value",
          "Step 7: Communicate Findings",
          "Legal Considerations for Appraisal",
          "Looking Ahead – Innovations in Property Valuation",
        ],
      },
    ],
  },
  {
    id: 17,
    name: "Direct Comparison (Comparative) and Cost Approaches of Appraisal",
    manualChapters: [
      {
        number: 22,
        title: "Direct Comparison (Comparative) and Cost Approaches of Appraisal",
        topics: [
          "Purpose of the Appraisal",
          "Direct Comparison (Comparative) or Market Approach",
          "Analysis of Market Transactions",
          "Adjustments for Value",
          "Further Applications of the Comparative Approach",
          "Scope and Limitations of the Comparative Approach",
          "The Comparative Approach and the Comparative Market Analysis",
          "The Cost Approach",
          "Determining Market Value by the Cost Approach",
          "Depreciation",
          "Scope and Limitations of the Cost Approach",
          "Calculations Used to Find Market Value of a Vendor Takeback",
          "Sample Construction Costs of a Single Family Residence",
          "Sample Comparative Market Analysis (CMA)",
        ],
      },
    ],
  },
  {
    id: 18,
    name: "The Income or Investment Approach of Appraisal",
    manualChapters: [
      {
        number: 23,
        title: "The Income or Investment Approach of Appraisal",
        topics: [
          "Establishing Net Operating Income",
          "Required Rate of Return",
          "Capitalization Process: Market Value",
        ],
      },
    ],
  },
  {
    id: 19,
    name: "From Contract to Completion",
    manualChapters: [
      {
        number: 24,
        title: "From Contract to Completion",
        topics: [
          "Information Required for Completion",
          "Closing Procedures",
          "General Introduction to Statements of Adjustments",
          "Items on Statements",
          "Preparing Statements of Adjustments",
          "Building Location Survey",
          "Sample Statement of Adjustments",
        ],
      },
    ],
  },
  {
    id: 20,
    name: "Marketing and Technology and the Real Estate Licensee",
    manualChapters: [
      {
        number: 25,
        title: "Introduction to Marketing",
        topics: [
          "Marketing and Real Estate: An Overview",
          "Marketing Theory",
          "Integrated Marketing",
          "Communication Process",
          "Advertising",
          "Other Types of Marketing",
          "Measuring the Effectiveness of Advertising and Marketing",
          "Listing Presentation",
          "Developing a Listing Marketing Program",
          "Competition Act",
        ],
      },
      {
        number: 26,
        title: "Technology and the Real Estate Licensee",
        topics: [
          "Technology and the Licensee’s Office",
          "Software, Apps, and Technological Devices",
          "Real Estate Licensee Websites",
          "Email Marketing",
          "Technological Resources",
          "Online Protocol",
          "Security, Computer, and Consumer Protection",
        ],
      },
    ],
  },
];

export const TOTAL_CHAPTERS = chapters.length;

/**
 * True for an integer chapter number from 1 to TOTAL_CHAPTERS.
 */
export function isValidChapterNumber(value) {
  return Number.isInteger(value) && value >= 1 && value <= TOTAL_CHAPTERS;
}

/**
 * Returns the chapter, or throws for an unknown chapter number.
 */
function findChapter(chapter) {
  const match = chapters.find((entry) => entry.id === chapter);
  if (!match) throw new Error(`Unknown chapter ${chapter}`);
  return match;
}

/**
 * Returns the chapter's name, or throws for an unknown chapter number.
 */
export function getChapterName(chapter) {
  return findChapter(chapter).name;
}

/**
 * Returns the course manual chapters the chapter covers ([] while their headings are missing), or throws for an
 * unknown chapter number.
 */
export function getManualChapters(chapter) {
  return findChapter(chapter).manualChapters;
}
