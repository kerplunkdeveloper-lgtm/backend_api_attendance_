const prisma = require("../config/database");

const DEFAULT_PRESETS = [
  {
    key: "MODERN_CORPORATE",
    name: "Corporate Slate",
    badge: "Most Popular",
    description: "Executive dual-column corporate format with crisp borders, statutory summary, and formal sign-off.",
    primaryColor: "#4f46e5",
    accentColor: "#0f172a",
    fontFamily: "Inter",
    headerLayout: "SPLIT",
    showBankDetails: true,
    showPanUan: true,
    showLeaveBalances: true,
    showAttendanceSummary: true,
    showOvertimeDetails: true,
    showNetSalaryInWords: true,
    showBarcodeOrQr: true,
    declarationText: "This is a computer-generated payslip and does not require a physical seal or signature.",
  },
  {
    key: "MINIMALIST",
    name: "Modern Minimalist",
    badge: "Clean & Modern",
    description: "Borderless tables, subtle background tints, prominent brand typography, and streamlined metrics.",
    primaryColor: "#0284c7",
    accentColor: "#334155",
    fontFamily: "Outfit",
    headerLayout: "CENTERED",
    showBankDetails: true,
    showPanUan: false,
    showLeaveBalances: true,
    showAttendanceSummary: true,
    showOvertimeDetails: true,
    showNetSalaryInWords: true,
    showBarcodeOrQr: false,
    declarationText: "Confidential document issued by authorized Human Resources & Payroll office.",
  },
  {
    key: "EXECUTIVE",
    name: "Executive Navy",
    badge: "Enterprise Standard",
    description: "Header band with deep midnight navy tone, statutory identification banner, and badge pill tags.",
    primaryColor: "#0f172a",
    accentColor: "#d97706",
    fontFamily: "Roboto",
    headerLayout: "BANNER",
    showBankDetails: true,
    showPanUan: true,
    showLeaveBalances: true,
    showAttendanceSummary: true,
    showOvertimeDetails: true,
    showNetSalaryInWords: true,
    showBarcodeOrQr: true,
    declarationText: "Official statement of earnings and statutory withholdings under corporate compliance.",
  },
  {
    key: "CLASSIC_COMPACT",
    name: "Classic Compact",
    badge: "Print Optimized",
    description: "High-density single-sheet format designed for low-ink business printers and statutory records.",
    primaryColor: "#16a34a",
    accentColor: "#1e293b",
    fontFamily: "Arial",
    headerLayout: "SPLIT",
    showBankDetails: true,
    showPanUan: true,
    showLeaveBalances: false,
    showAttendanceSummary: true,
    showOvertimeDetails: false,
    showNetSalaryInWords: true,
    showBarcodeOrQr: false,
    declarationText: "System generated salary advice statement.",
  },
];

class PayslipTemplateService {
  /**
   * List system preset definitions
   */
  getPresets() {
    return DEFAULT_PRESETS;
  }

  /**
   * Get active template for organization (or fallback to organization default)
   */
  async getOrganizationTemplate(organizationId) {
    let template = await prisma.payslipTemplate.findUnique({
      where: { organizationId },
    });

    if (!template) {
      // Find organization name & address to auto-populate default template
      const org = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { name: true, email: true, phone: true },
      });

      const defaultPreset = DEFAULT_PRESETS[0];

      template = await prisma.payslipTemplate.create({
        data: {
          organizationId,
          name: defaultPreset.name,
          templateKey: defaultPreset.key,
          companyName: org?.name || "",
          contactEmail: org?.email || "",
          contactPhone: org?.phone || "",
          addressLine1: "",
          addressLine2: "",
          taxIdentifierLabel: "CIN / GSTIN",
          taxIdentifierValue: "",
          primaryColor: defaultPreset.primaryColor,
          accentColor: defaultPreset.accentColor,
          fontFamily: defaultPreset.fontFamily,
          headerLayout: defaultPreset.headerLayout,
          showBankDetails: defaultPreset.showBankDetails,
          showPanUan: defaultPreset.showPanUan,
          showLeaveBalances: defaultPreset.showLeaveBalances,
          showAttendanceSummary: defaultPreset.showAttendanceSummary,
          showOvertimeDetails: defaultPreset.showOvertimeDetails,
          showNetSalaryInWords: defaultPreset.showNetSalaryInWords,
          showBarcodeOrQr: defaultPreset.showBarcodeOrQr,
          declarationText: defaultPreset.declarationText,
        },
      });
    }

    return template;
  }

  /**
   * Upsert custom template settings for organization
   */
  async upsertOrganizationTemplate(organizationId, data) {
    const payload = {
      name: data.name || "Custom Payslip Template",
      templateKey: data.templateKey || "MODERN_CORPORATE",
      logoUrl: data.logoUrl !== undefined ? data.logoUrl : null,
      companyName: data.companyName,
      addressLine1: data.addressLine1,
      addressLine2: data.addressLine2,
      taxIdentifierLabel: data.taxIdentifierLabel || "CIN / GSTIN",
      taxIdentifierValue: data.taxIdentifierValue,
      contactEmail: data.contactEmail,
      contactPhone: data.contactPhone,
      primaryColor: data.primaryColor || "#4f46e5",
      accentColor: data.accentColor || "#0f172a",
      fontFamily: data.fontFamily || "Inter",
      headerLayout: data.headerLayout || "SPLIT",
      showBankDetails: Boolean(data.showBankDetails),
      showPanUan: Boolean(data.showPanUan),
      showLeaveBalances: Boolean(data.showLeaveBalances),
      showAttendanceSummary: Boolean(data.showAttendanceSummary),
      showOvertimeDetails: Boolean(data.showOvertimeDetails),
      showNetSalaryInWords: Boolean(data.showNetSalaryInWords),
      showBarcodeOrQr: Boolean(data.showBarcodeOrQr),
      signatoryName: data.signatoryName || null,
      signatoryTitle: data.signatoryTitle || null,
      signatureImageUrl: data.signatureImageUrl !== undefined ? data.signatureImageUrl : null,
      declarationText: data.declarationText || "This is a computer-generated payslip and does not require a physical seal or signature.",
      footerNotes: data.footerNotes || null,
      customHtml: data.customHtml || null,
      customCss: data.customCss || null,
    };

    return await prisma.payslipTemplate.upsert({
      where: { organizationId },
      update: payload,
      create: {
        organizationId,
        ...payload,
      },
    });
  }

  /**
   * Reset template to a specific system preset
   */
  async resetToPreset(organizationId, presetKey) {
    const preset = DEFAULT_PRESETS.find((p) => p.key === presetKey) || DEFAULT_PRESETS[0];
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, email: true, phone: true },
    });

    return await prisma.payslipTemplate.upsert({
      where: { organizationId },
      update: {
        name: preset.name,
        templateKey: preset.key,
        primaryColor: preset.primaryColor,
        accentColor: preset.accentColor,
        fontFamily: preset.fontFamily,
        headerLayout: preset.headerLayout,
        showBankDetails: preset.showBankDetails,
        showPanUan: preset.showPanUan,
        showLeaveBalances: preset.showLeaveBalances,
        showAttendanceSummary: preset.showAttendanceSummary,
        showOvertimeDetails: preset.showOvertimeDetails,
        showNetSalaryInWords: preset.showNetSalaryInWords,
        showBarcodeOrQr: preset.showBarcodeOrQr,
        declarationText: preset.declarationText,
        customHtml: null,
        customCss: null,
      },
      create: {
        organizationId,
        name: preset.name,
        templateKey: preset.key,
        companyName: org?.name || "",
        contactEmail: org?.email || "",
        contactPhone: org?.phone || "",
        addressLine1: "",
        taxIdentifierLabel: "CIN / GSTIN",
        taxIdentifierValue: "",
        primaryColor: preset.primaryColor,
        accentColor: preset.accentColor,
        fontFamily: preset.fontFamily,
        headerLayout: preset.headerLayout,
        showBankDetails: preset.showBankDetails,
        showPanUan: preset.showPanUan,
        showLeaveBalances: preset.showLeaveBalances,
        showAttendanceSummary: preset.showAttendanceSummary,
        showOvertimeDetails: preset.showOvertimeDetails,
        showNetSalaryInWords: preset.showNetSalaryInWords,
        showBarcodeOrQr: preset.showBarcodeOrQr,
        declarationText: preset.declarationText,
      },
    });
  }
}

module.exports = new PayslipTemplateService();
