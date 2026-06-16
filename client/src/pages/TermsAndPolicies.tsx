import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { FULL_TERMS_SECTIONS, CODE_OF_CONDUCT_SECTIONS, APPENDIX_SECTIONS } from "./policyData";

// ─── Privacy Policy content (drafted for JLT Group) ──────────────────────────
const PRIVACY_SECTIONS = [
  {
    title: "1. Who We Are",
    content: `<p>The JLT Group is incorporated in England and Wales with company number 12178075, whose registered office is at 20-22 Wenlock Road, London, UK ("we", "us", "our").</p>
<p>We are the data controller for personal data collected through this portal and our agent membership programme. For any privacy-related enquiries, please contact us at <strong>support@thejltgroup.co.uk</strong>.</p>`,
  },
  {
    title: "2. What Data We Collect",
    content: `<p>We collect and process the following categories of personal data from agents and prospective agents:</p>
<ul>
<li><strong>Identity data:</strong> full name, date of birth, national insurance number, proof of identity documents.</li>
<li><strong>Contact data:</strong> email address, telephone number, home address.</li>
<li><strong>Financial data:</strong> bank account details for commission payments, VAT registration number where applicable.</li>
<li><strong>Professional data:</strong> trading name, business address, ATOL/ABTA registration details, professional qualifications.</li>
<li><strong>Usage data:</strong> login activity, booking records, commission claims, amendment and refund requests made through the portal.</li>
<li><strong>Technical data:</strong> IP address, browser type, device information collected at the time of signing agreements for audit purposes.</li>
<li><strong>Communications data:</strong> messages sent through the portal's messaging system.</li>
</ul>`,
  },
  {
    title: "3. How We Use Your Data",
    content: `<p>We use your personal data for the following purposes:</p>
<ul>
<li>To administer your agent membership and process your application.</li>
<li>To facilitate bookings, amendments, cancellations, and refunds on your behalf.</li>
<li>To calculate, process, and pay commissions and reimbursements.</li>
<li>To verify your identity and comply with anti-money laundering obligations.</li>
<li>To maintain audit records of agreements signed through the portal.</li>
<li>To communicate with you regarding your membership, bookings, and account.</li>
<li>To comply with our legal and regulatory obligations.</li>
<li>To improve our portal and services.</li>
</ul>`,
  },
  {
    title: "4. Legal Basis for Processing",
    content: `<p>We process your personal data on the following legal bases under UK GDPR:</p>
<ul>
<li><strong>Contract performance:</strong> processing necessary to administer your membership agreement and provide our services.</li>
<li><strong>Legal obligation:</strong> processing required to comply with applicable law (e.g. anti-money laundering, ATOL regulations).</li>
<li><strong>Legitimate interests:</strong> processing for fraud prevention, security, and improving our services, where these interests are not overridden by your rights.</li>
<li><strong>Consent:</strong> where we have obtained your explicit consent, such as for marketing communications.</li>
</ul>`,
  },
  {
    title: "5. Who We Share Your Data With",
    content: `<p>We may share your personal data with:</p>
<ul>
<li><strong>Suppliers and operators:</strong> travel suppliers, airlines, and operators where necessary to process bookings on your behalf.</li>
<li><strong>Payment processors:</strong> our payment service providers for processing membership fees and commission payments.</li>
<li><strong>Regulatory bodies:</strong> ATOL, ABTA, HMRC, and other regulatory authorities where required by law.</li>
<li><strong>Service providers:</strong> IT infrastructure, cloud storage, and software providers who process data on our behalf under data processing agreements.</li>
<li><strong>Professional advisers:</strong> solicitors, accountants, and auditors where necessary.</li>
</ul>
<p>We do not sell your personal data to third parties.</p>`,
  },
  {
    title: "6. International Transfers",
    content: `<p>We primarily process your data within the United Kingdom and the European Economic Area. Where data is transferred outside these areas, we ensure appropriate safeguards are in place in accordance with UK GDPR, including standard contractual clauses or adequacy decisions.</p>`,
  },
  {
    title: "7. Data Retention",
    content: `<p>We retain your personal data for as long as necessary to fulfil the purposes for which it was collected, including:</p>
<ul>
<li>For the duration of your membership and for 7 years thereafter (for financial and contractual records).</li>
<li>For 6 years after the termination of your membership for general records (in line with the Limitation Act 1980).</li>
<li>Longer periods where required by law or regulatory obligation.</li>
</ul>
<p>After the applicable retention period, your data will be securely deleted or anonymised.</p>`,
  },
  {
    title: "8. Your Rights",
    content: `<p>Under UK GDPR, you have the following rights in relation to your personal data:</p>
<ul>
<li><strong>Right of access:</strong> to request a copy of the personal data we hold about you.</li>
<li><strong>Right to rectification:</strong> to request correction of inaccurate or incomplete data.</li>
<li><strong>Right to erasure:</strong> to request deletion of your data in certain circumstances.</li>
<li><strong>Right to restrict processing:</strong> to request that we limit how we use your data.</li>
<li><strong>Right to data portability:</strong> to receive your data in a structured, machine-readable format.</li>
<li><strong>Right to object:</strong> to object to processing based on legitimate interests.</li>
<li><strong>Rights related to automated decision-making:</strong> to not be subject to solely automated decisions that significantly affect you.</li>
</ul>
<p>To exercise any of these rights, please contact us at <strong>support@thejltgroup.co.uk</strong>. We will respond within one month.</p>`,
  },
  {
    title: "9. Cookies and Tracking",
    content: `<p>Our portal uses session cookies solely for authentication purposes. These are strictly necessary cookies and do not track your activity across other websites. We do not use advertising or analytics cookies without your consent.</p>`,
  },
  {
    title: "10. Security",
    content: `<p>We implement appropriate technical and organisational measures to protect your personal data against unauthorised access, loss, or disclosure. These include encrypted data transmission (HTTPS), access controls, and regular security reviews.</p>`,
  },
  {
    title: "11. Complaints",
    content: `<p>If you have concerns about how we handle your personal data, you have the right to lodge a complaint with the Information Commissioner's Office (ICO) at <strong>ico.org.uk</strong> or by calling 0303 123 1113.</p>
<p>We would, however, appreciate the opportunity to address your concerns directly before you contact the ICO. Please contact us at <strong>support@thejltgroup.co.uk</strong>.</p>`,
  },
  {
    title: "12. Changes to This Policy",
    content: `<p>We may update this Privacy Policy from time to time. Where changes are material, we will notify you by email or through the portal. The date of the most recent revision appears at the top of this page.</p>
<p><em>Last updated: May 2026</em></p>`,
  },
];

// ─── Shared prose styles injected into dangerouslySetInnerHTML sections ───────
const PROSE_CLASS =
  "prose prose-sm max-w-none text-foreground [&_p]:mb-3 [&_ul]:mb-3 [&_ul]:pl-5 [&_li]:mb-1 [&_ol]:mb-3 [&_ol]:pl-5 [&_strong]:font-semibold [&_table]:w-full [&_table]:border-collapse [&_th]:bg-muted [&_th]:p-2 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold [&_td]:p-2 [&_td]:border [&_td]:border-border [&_td]:text-sm [&_tr:nth-child(even)_td]:bg-muted/30";

export default function TermsAndPolicies() {
  const [openTermsItems, setOpenTermsItems] = useState<string[]>([]);
  const [openCocItems, setOpenCocItems] = useState<string[]>([]);
  const [openPrivacyItems, setOpenPrivacyItems] = useState<string[]>([]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ── Header ── */}
      <header className="border-b border-border bg-card sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center font-bold text-sm flex-shrink-0"
            style={{ background: "#70FFE8", color: "#414141" }}
          >
            JLT
          </div>
          <div>
            <h1 className="font-semibold text-base leading-tight">The JLT Group</h1>
            <p className="text-xs text-muted-foreground">Agent Terms &amp; Policies</p>
          </div>
        </div>
      </header>

      {/* ── Main ── */}
      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h2 className="text-2xl font-bold">Agent Terms &amp; Policies</h2>
          <p className="text-muted-foreground text-sm mt-1">
            These documents govern your membership with The JLT Group. Please read each section carefully.
          </p>
          <p className="text-xs text-muted-foreground mt-1">Terms &amp; Conditions last updated: <strong>May 2026</strong></p>
        </div>

        <Tabs defaultValue="terms">
          <TabsList className="mb-6 h-auto flex-wrap gap-1">
            <TabsTrigger value="terms" className="text-sm">
              Full Terms &amp; Conditions
            </TabsTrigger>
            <TabsTrigger value="conduct" className="text-sm">
              Code of Conduct
            </TabsTrigger>
            <TabsTrigger value="privacy" className="text-sm">
              Privacy Policy
            </TabsTrigger>
            <TabsTrigger value="appendices" className="text-sm">
              Appendices
            </TabsTrigger>
          </TabsList>

          {/* ── Full Terms Tab ── */}
          <TabsContent value="terms">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {FULL_TERMS_SECTIONS.length} sections — click a section to expand it.
              </p>
              <div className="flex gap-2">
                <button
                  className="text-xs text-primary underline"
                  onClick={() =>
                    setOpenTermsItems(FULL_TERMS_SECTIONS.map((_, i) => `terms-${i}`))
                  }
                >
                  Expand all
                </button>
                <span className="text-xs text-muted-foreground">·</span>
                <button
                  className="text-xs text-primary underline"
                  onClick={() => setOpenTermsItems([])}
                >
                  Collapse all
                </button>
              </div>
            </div>

            {/* Two-column grid for the accordion on wider screens */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6">
              {/* Left column: sections 0–24 */}
              <Accordion
                type="multiple"
                value={openTermsItems}
                onValueChange={setOpenTermsItems}
              >
                {FULL_TERMS_SECTIONS.slice(0, 25).map((section, i) => (
                  <AccordionItem key={`terms-${i}`} value={`terms-${i}`}>
                    <AccordionTrigger className="text-sm font-medium text-left py-3 hover:no-underline">
                      {section.title}
                    </AccordionTrigger>
                    <AccordionContent>
                      <div
                        className={PROSE_CLASS}
                        dangerouslySetInnerHTML={{ __html: section.content }}
                      />
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>

              {/* Right column: sections 25–48 */}
              <Accordion
                type="multiple"
                value={openTermsItems}
                onValueChange={setOpenTermsItems}
              >
                {FULL_TERMS_SECTIONS.slice(25).map((section, i) => (
                  <AccordionItem key={`terms-${i + 25}`} value={`terms-${i + 25}`}>
                    <AccordionTrigger className="text-sm font-medium text-left py-3 hover:no-underline">
                      {section.title}
                    </AccordionTrigger>
                    <AccordionContent>
                      <div
                        className={PROSE_CLASS}
                        dangerouslySetInnerHTML={{ __html: section.content }}
                      />
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>

            <p className="text-xs text-muted-foreground mt-6 border-t border-border pt-4">
              The JLT Group — Company No. 12178075 — Registered in England and Wales.
              Registered office: 20-22 Wenlock Road, London, UK.
            </p>
          </TabsContent>

          {/* ── Code of Conduct Tab ── */}
          <TabsContent value="conduct">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {CODE_OF_CONDUCT_SECTIONS.length} sections — click a section to expand it.
              </p>
              <div className="flex gap-2">
                <button
                  className="text-xs text-primary underline"
                  onClick={() =>
                    setOpenCocItems(CODE_OF_CONDUCT_SECTIONS.map((_, i) => `coc-${i}`))
                  }
                >
                  Expand all
                </button>
                <span className="text-xs text-muted-foreground">·</span>
                <button
                  className="text-xs text-primary underline"
                  onClick={() => setOpenCocItems([])}
                >
                  Collapse all
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6">
              <Accordion
                type="multiple"
                value={openCocItems}
                onValueChange={setOpenCocItems}
              >
                {CODE_OF_CONDUCT_SECTIONS.slice(0, 12).map((section, i) => (
                  <AccordionItem key={`coc-${i}`} value={`coc-${i}`}>
                    <AccordionTrigger className="text-sm font-medium text-left py-3 hover:no-underline">
                      {section.title}
                    </AccordionTrigger>
                    <AccordionContent>
                      <div
                        className={PROSE_CLASS}
                        dangerouslySetInnerHTML={{ __html: section.content }}
                      />
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>

              <Accordion
                type="multiple"
                value={openCocItems}
                onValueChange={setOpenCocItems}
              >
                {CODE_OF_CONDUCT_SECTIONS.slice(12).map((section, i) => (
                  <AccordionItem key={`coc-${i + 12}`} value={`coc-${i + 12}`}>
                    <AccordionTrigger className="text-sm font-medium text-left py-3 hover:no-underline">
                      {section.title}
                    </AccordionTrigger>
                    <AccordionContent>
                      <div
                        className={PROSE_CLASS}
                        dangerouslySetInnerHTML={{ __html: section.content }}
                      />
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>

            <p className="text-xs text-muted-foreground mt-6 border-t border-border pt-4">
              This Code of Conduct forms Appendix L of the JLT Group Membership Agreement.
              For queries contact <strong>support@thejltgroup.co.uk</strong>.
            </p>
          </TabsContent>

          {/* ── Privacy Policy Tab ── */}
          <TabsContent value="privacy">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {PRIVACY_SECTIONS.length} sections — click a section to expand it.
              </p>
              <div className="flex gap-2">
                <button
                  className="text-xs text-primary underline"
                  onClick={() =>
                    setOpenPrivacyItems(PRIVACY_SECTIONS.map((_, i) => `priv-${i}`))
                  }
                >
                  Expand all
                </button>
                <span className="text-xs text-muted-foreground">·</span>
                <button
                  className="text-xs text-primary underline"
                  onClick={() => setOpenPrivacyItems([])}
                >
                  Collapse all
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6">
              <Accordion
                type="multiple"
                value={openPrivacyItems}
                onValueChange={setOpenPrivacyItems}
              >
                {PRIVACY_SECTIONS.slice(0, 6).map((section, i) => (
                  <AccordionItem key={`priv-${i}`} value={`priv-${i}`}>
                    <AccordionTrigger className="text-sm font-medium text-left py-3 hover:no-underline">
                      {section.title}
                    </AccordionTrigger>
                    <AccordionContent>
                      <div
                        className={PROSE_CLASS}
                        dangerouslySetInnerHTML={{ __html: section.content }}
                      />
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>

              <Accordion
                type="multiple"
                value={openPrivacyItems}
                onValueChange={setOpenPrivacyItems}
              >
                {PRIVACY_SECTIONS.slice(6).map((section, i) => (
                  <AccordionItem key={`priv-${i + 6}`} value={`priv-${i + 6}`}>
                    <AccordionTrigger className="text-sm font-medium text-left py-3 hover:no-underline">
                      {section.title}
                    </AccordionTrigger>
                    <AccordionContent>
                      <div
                        className={PROSE_CLASS}
                        dangerouslySetInnerHTML={{ __html: section.content }}
                      />
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>

            <p className="text-xs text-muted-foreground mt-6 border-t border-border pt-4">
              The JLT Group is registered with the Information Commissioner's Office (ICO).
              For data queries contact <strong>support@thejltgroup.co.uk</strong>.
            </p>
          </TabsContent>

          {/* ── Appendices Tab ── */}
          <TabsContent value="appendices">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {APPENDIX_SECTIONS.length} appendices — click an appendix to expand it.
              </p>
            </div>
            <Accordion type="multiple" className="space-y-2">
              {APPENDIX_SECTIONS.map((section, i) => (
                <AccordionItem key={i} value={`appendix-${i}`} className="border border-border rounded-lg px-4">
                  <AccordionTrigger className="text-sm font-medium hover:no-underline py-3">
                    {section.title}
                  </AccordionTrigger>
                  <AccordionContent>
                    <div
                      className={PROSE_CLASS}
                      dangerouslySetInnerHTML={{ __html: section.content }}
                    />
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
            <p className="text-xs text-muted-foreground mt-6 border-t border-border pt-4">
              These appendices form part of the JLT Group Membership Agreement. Appendix L (Code of Conduct) is available in full under the Code of Conduct tab.
            </p>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
