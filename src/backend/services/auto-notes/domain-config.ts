/**
 * Domain Context Configuration
 *
 * Room-specific keyword profiles injected into classifier prompts.
 * Helps the LLM understand what's meaningful in different contexts.
 */

export type DomainProfile =
  | "general"
  | "medical"
  | "engineering"
  | "home"
  | "education"
  | "business";

export interface DomainContext {
  name: string;
  description: string;
  /** High-signal keywords — even short chunks with these should go to LLM */
  highSignalKeywords: string[];
  /** Context injected into the classifier prompt */
  promptContext: string;
}

export const DOMAIN_PROFILES: Record<DomainProfile, DomainContext> = {
  general: {
    name: "General",
    description: "Default profile with sensible defaults",
    highSignalKeywords: [
      "meeting",
      "deadline",
      "decision",
      "action item",
      "follow up",
      "important",
      "urgent",
      "cancel",
      "approve",
      "confirmed",
      "agreed",
      "budget",
      "schedule",
    ],
    promptContext:
      "General context. Flag anything that sounds like a decision, action item, planning discussion, or substantive conversation between people.",
  },

  medical: {
    name: "Medical",
    description: "Healthcare / clinical setting",
    highSignalKeywords: [
      "patient",
      "diagnosis",
      "medication",
      "dosage",
      "vitals",
      "blood pressure",
      "procedure",
      "surgery",
      "prescription",
      "allergic",
      "symptoms",
      "treatment",
      "referral",
      "discharge",
      "consent",
    ],
    promptContext:
      "Medical/clinical setting. Flag discussions about patients, diagnoses, treatment plans, medications, procedures, and clinical decisions. Even brief mentions of patient names or medication changes are meaningful.",
  },

  engineering: {
    name: "Engineering",
    description: "Software engineering / tech team",
    highSignalKeywords: [
      "deploy",
      "sprint",
      "bug",
      "migration",
      "deadline",
      "release",
      "incident",
      "outage",
      "rollback",
      "PR",
      "merge",
      "blocked",
      "dependency",
      "architecture",
      "breaking change",
    ],
    promptContext:
      "Software engineering context. Flag discussions about technical decisions, sprint planning, deployments, bugs, incidents, architecture choices, and code reviews.",
  },

  home: {
    name: "Home",
    description: "Personal / home context",
    highSignalKeywords: [
      "appointment",
      "doctor",
      "school",
      "pickup",
      "dinner",
      "grocery",
      "repair",
      "payment",
      "bill",
      "birthday",
      "travel",
      "flight",
      "reservation",
    ],
    promptContext:
      "Personal/home context. Flag discussions about appointments, family planning, household tasks, errands, finances, and personal commitments.",
  },

  education: {
    name: "Education",
    description: "Educational / academic setting",
    highSignalKeywords: [
      "assignment",
      "exam",
      "lecture",
      "grade",
      "thesis",
      "research",
      "deadline",
      "submission",
      "professor",
      "study group",
      "presentation",
      "curriculum",
    ],
    promptContext:
      "Educational setting. Flag discussions about assignments, lectures, study sessions, research topics, academic deadlines, and group projects.",
  },

  business: {
    name: "Business",
    description: "Business / corporate setting",
    highSignalKeywords: [
      "revenue",
      "client",
      "contract",
      "proposal",
      "negotiation",
      "quarterly",
      "KPI",
      "pipeline",
      "partnership",
      "stakeholder",
      "compliance",
      "liability",
      "acquisition",
    ],
    promptContext:
      "Business/corporate setting. Flag discussions about deals, clients, contracts, finances, strategy, compliance, and stakeholder communications.",
  },
};

/**
 * Check if text contains any high-signal keywords for a domain
 */
export function containsHighSignalKeyword(
  text: string,
  profile: DomainProfile,
): boolean {
  const lower = text.toLowerCase();
  return DOMAIN_PROFILES[profile].highSignalKeywords.some((kw) =>
    lower.includes(kw.toLowerCase()),
  );
}

/**
 * Get the prompt context string for a domain profile
 */
export function getDomainPromptContext(profile: DomainProfile): string {
  return DOMAIN_PROFILES[profile].promptContext;
}
