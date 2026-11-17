const DEFAULT_EXIT_DOCUMENT_TEMPLATES = {
  branding: {
    primaryColor: "#4f46e5",
    footer: "This is a digitally generated document. Please retain a copy for your records.",
    signatoryName: "",
  },
  FF_STATEMENT: {
    title: "Full & Final Settlement Statement",
    subtitle: "Formal Statement of Accounts & Separation Dues",
    paymentMode: "Bank NEFT / Direct Credit",
    signatoryTitle: "Authorized Signatory (HR / Finance)",
    acceptanceTitle: "Employee Acceptance Signature",
  },
  CLEARANCE_CERTIFICATE: {
    title: "No-Dues Clearance Certificate",
    subtitle: "Official Departmental Exit Sign-Off Form",
    introduction: "This is to certify that {{employeeName}} (Employee Code: {{employeeCode}}), working in the {{department}} department, has completed all necessary separation protocols and project handovers. The clearance status across all functional business units is recorded below:",
    closing: "Based on the verified endorsements above, the organization confirms that no assets or financial liabilities are outstanding.",
    leftSignatoryTitle: "Head of Human Resources",
    rightSignatoryTitle: "Corporate Finance Controller",
  },
  RELIEVING_LETTER: {
    title: "Relieving Order",
    subject: "Relieving Letter from Services of {{companyName}}",
    greeting: "Dear {{employeeName}},",
    paragraph1: "This has reference to your formal resignation letter dated {{resignationDate}}. We would like to confirm that your resignation has been accepted and you are hereby officially relieved from your duties and services at {{companyName}} with effect from the close of business hours on {{lastWorkingDay}}.",
    paragraph2: "We confirm that all company assets, credentials, and documentation under your stewardship have been satisfactorily returned and your Full & Final accounts have been settled in accordance with organizational policy.",
    paragraph3: "We take this opportunity to appreciate your contributions during your tenure with the organization and wish you every success in your future personal and professional endeavors.",
    signatoryTitle: "Authorized Signatory",
    signatorySubtitle: "People Operations & Human Resources",
  },
  EXPERIENCE_LETTER: {
    title: "Service & Experience Certificate",
    subtitle: "To Whomsoever It May Concern",
    paragraph1: "This is to certify that {{employeeName}} (Employee ID: {{employeeCode}}) was gainfully employed with {{companyName}} from {{joiningDate}} to {{lastWorkingDay}}.",
    paragraph2: "At the time of leaving the organization, {{employeeName}} was holding the position of {{designation}} in the {{department}} department, operating out of our {{branch}} office.",
    paragraph3: "During their tenure of employment with us, we observed them to be diligent, sincere, result-oriented, and professional in their conduct. Their character and commitment towards assigned responsibilities have been exemplary.",
    paragraph4: "We certify that they have performed their duties to our complete satisfaction and we wish them great success in all their future pursuits.",
    signatoryTitle: "Head of Human Resources",
  },
};

const text = (value, fallback, max) => {
  const result = String(value ?? "").trim();
  return (result || fallback).slice(0, max);
};

const normalizeExitDocumentTemplates = (value = {}) => {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const result = { branding: { ...DEFAULT_EXIT_DOCUMENT_TEMPLATES.branding } };
  result.branding.primaryColor = /^#[0-9a-f]{6}$/i.test(String(source.branding?.primaryColor || "")) ? source.branding.primaryColor : result.branding.primaryColor;
  result.branding.footer = text(source.branding?.footer, result.branding.footer, 500);
  result.branding.signatoryName = text(source.branding?.signatoryName, "", 120);
  for (const key of ["FF_STATEMENT", "CLEARANCE_CERTIFICATE", "RELIEVING_LETTER", "EXPERIENCE_LETTER"]) {
    result[key] = {};
    for (const [field, fallback] of Object.entries(DEFAULT_EXIT_DOCUMENT_TEMPLATES[key])) {
      result[key][field] = text(source[key]?.[field], fallback, field.includes("paragraph") || field === "introduction" || field === "closing" ? 1800 : 300);
    }
  }
  return result;
};

module.exports = { DEFAULT_EXIT_DOCUMENT_TEMPLATES, normalizeExitDocumentTemplates };
