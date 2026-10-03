# JLT Training Academy — Refreshed Scope

**Status:** Proposal for review  
**Recommended product name:** **JLT Academy**  
**Delivery model:** Built inside the existing secure JLT Booking Portal — not a separate login or standalone learning platform.

## 1. Executive recommendation

JLT should replace the current external-Training-Hub hand-off with a **portal-native Academy** that gives every active agent one clear answer to:

> **What do I need to learn next, what access does it unlock, and what support is available?**

The Academy should serve three connected purposes:

1. **New-agent pathway** — a structured, practical route from onboarding through first booking and sign-off.
2. **Ongoing development** — supplier, sales, marketing, compliance and business-growth learning for established agents.
3. **Operational assurance** — clear evidence of completion, knowledge checks and staff approval before selected supplier credentials or stages of access are unlocked.

It should **not** try to become a generic university-style LMS in its first release. The useful differentiator is that it can connect learning to what JLT already manages: onboarding, supplier access, event RSVPs, membership tier, agent training stage, CRM and operational tasks.

---

## 2. What already exists in the Portal

The Academy can build on meaningful existing foundations rather than starting from zero.

| Existing foundation | Current use | Academy reuse |
|---|---|---|
| **Onboarding dashboard** | Agent self-setup, ID, profile and JLT email preference | First Academy checkpoint and route into the Starter Pathway |
| **Admin onboarding checklist** | Includes “Create Training Hub Login” alongside JLT email, contract, ID and welcome steps | Replace the external-login step with **Invite / enrol in JLT Academy** |
| **Training stages** | CRM supports `Training`, `Agent Accelerator` and `Accredited` | Display progression and use as a controlled outcome of Academy completion |
| **Supplier access stages** | CRM has Training Only → Select Credentials → Full Access | Unlock only defined access milestones after required learning and/or admin sign-off |
| **Agent-facing calendar** | Training, webinar and supplier-event categories; RSVP and attendee data | Academy live-session schedule, attendance prompts and recordings |
| **Community Hub** | Training & Webinars posts, content views and read confirmations | News, highlights, optional discussion links and recording announcements |
| **Email marketing / workflow system** | Agent segments by status, membership tier, training stage and tags | Targeted Academy nudges and cohort communications |
| **Secure file storage** | Existing S3-backed uploads and document patterns | Academy worksheets, PDFs, templates and downloadable tools |

There is also an existing legacy report script referencing **LearnWorlds** users. That indicates the Academy should include a deliberate migration / archival plan rather than treating the old platform as a permanent parallel system.

---

## 3. Agent experience

### Academy home

A new **Academy** item in the agent navigation opens a personalised dashboard:

- **Continue learning** — one obvious next lesson / action.
- **Your pathway progress** — percentage, completed modules and what remains.
- **Next live sessions** — training and supplier events from the existing calendar, with RSVP status.
- **Required actions** — a small, clear panel for a failed assessment, overdue task or item awaiting staff review.
- **Resource library** — searchable templates, checklists, guides and recordings.
- **Recent releases** — new or updated lessons, supplier updates and recordings.

The page should use plain operational language rather than academic jargon: *“Complete this before requesting supplier logins”* is more useful than *“Module prerequisite pending.”*

### Course and lesson flow

Each pathway contains ordered modules, each with lessons. A lesson can contain:

- Short written guidance, images and call-out panels
- A hosted video or trusted embed (for example Loom / Vimeo / YouTube where authorised)
- Downloads such as PDF guides, checklists or templates
- A practical task / acknowledgement
- A short scored knowledge check
- A “need help?” route to the relevant Community post, event or support channel

The learner sees a clear **Complete and continue** action. Progress saves automatically, so leaving and returning never loses their place.

### Assessments and evidence

For the first release, assessments should be deliberately simple and robust:

- Multiple-choice and true/false questions
- Configurable pass mark (recommended default: **80%**)
- A small question bank with randomised question order
- Immediate feedback for formative lessons; configurable delayed feedback for compliance checks
- Attempt history retained for staff
- A practical checklist or evidence upload only where genuinely needed
- Optional staff review before a gated outcome is granted

This gives JLT verifiable learning evidence without building complex exam software prematurely.

---

## 4. Recommended Academy structure

### A. Starter Pathway — required for new agents

| Module | Core outcome | Typical completion evidence |
|---|---|---|
| **1. Welcome to JLT** | Understand the membership, support model, key people and first 30 days | Watch / acknowledge + short knowledge check |
| **2. Operating Safely** | Know the boundaries: compliance, PTS, protection, records, data handling and when to ask | Required assessment |
| **3. Your Booking Workflow** | Register bookings, documents, amendments, refunds, cancellations and commission claims correctly | Interactive checklist + knowledge check |
| **4. Getting Paid Correctly** | Understand commission timing, pre-authorisation rules, top-ups, reimbursements and expected paperwork | Required assessment |
| **5. Suppliers & Credentials** | Know how JLT supplier access works, what information must never be shared and when credentials unlock | Acknowledgement + staff-controlled sign-off |
| **6. Finding and Converting Enquiries** | Consultation, quote quality, follow-up, value framing and using the public profile / Holiday Showcase | Optional task and resources |
| **7. First Booking Ready** | Build a practical first-booking plan and know where support sits | Staff review or completion checklist |

**Recommended result:** completion moves the agent from `Training` to **Agent Accelerator**, subject to any staff-only checks.

### B. Agent Accelerator — guided early trading

This should be a shorter, more applied pathway for agents now working with customers:

- Consultations and discovery calls
- Building commercially sound quotes
- Amendments, refunds and client expectation management
- Ancillaries and proactive pre-departure service
- Working with key suppliers
- Brand and marketing basics
- First booking, first commission and first testimonial milestones

**Recommended result:** a deliberate **Accredited** decision remains staff-controlled. Completion should present the candidate as *ready for review*, not silently award accreditation.

### C. Specialist Collections — ongoing and optional

After the core programme, the Academy becomes a resource agents continue to use:

- **Supplier spotlights** — one compact collection per supplier; optional or required where access rules demand it
- **Product and destination knowledge**
- **Sales and conversion**
- **Marketing / social media**
- **Business growth and productivity**
- **Service recovery and difficult customer conversations**
- **Compliance updates** — versioned required acknowledgements

These collections should not automatically change an agent’s overarching training stage. They create topic badges / completion records and can be targeted to the right groups.

---

## 5. Administration experience

### Academy manager

A new admin area, **Academy Manager**, should provide:

- Course / collection list with Draft, Published and Archived status
- Drag-and-drop module and lesson ordering
- Cohort assignment: all active agents, a training stage, membership tier, tags, selected people or new joiners
- Required / optional setting and due-date rule
- Completion, started, overdue and at-risk headline figures
- Per-agent drill-down: current lesson, completion, assessment score / attempts, evidence and staff review state
- Publish history and a clear “updated since your last completion” indicator for materially changed compliance content

### Content authoring

Staff should be able to create and edit most content without code:

- Title, summary, estimated time and thumbnail
- Rich text blocks
- Video / embed URL
- Attachments and downloads
- Checklists and acknowledgements
- Question builder
- Required prerequisites
- Whether the lesson or collection leads to a defined action: **nothing**, *eligible for review*, *unlock supplier stage*, or *change training stage after staff approval*

A simple editor with reliable previews is preferable to a complex free-form page builder. Each lesson should have a desktop and mobile preview before publication.

### Governance and approvals

To avoid accidental agent disruption:

- Authors can save **Drafts**.
- Only Admin / Super Admin can **Publish** a course or make a learning item mandatory.
- Major changes to a required compliance lesson create a new version and a re-acknowledgement requirement.
- Training-stage promotion and supplier-access changes require an explicit staff action unless a particular rule is deliberately configured for automation.
- Archive content without deleting historical completions.

---

## 6. Integration rules

### Onboarding

1. A new member completes the existing profile / documentation onboarding.
2. Staff confirm the existing onboarding checklist.
3. Instead of creating a separate external Training Hub login, staff enrol the agent in **Starter Pathway**.
4. The agent receives a branded portal notification and email linking to `/academy`.
5. The Academy home shows the starter programme as the primary action.

### CRM and training stages

Keep the CRM statuses already in use:

- **Training** — enrolled in Starter Pathway / completing core requirements
- **Agent Accelerator** — starter curriculum completed and approved for guided trading development
- **Accredited** — staff approved after the Accelerator requirements and any operational checks

The Academy should show *why* an agent is at a stage; CRM remains the operational source of truth for staff editing and exceptional cases.

### Supplier credentials

Use the existing three supplier-directory stages as the controlled output:

1. **Training Only** — learning resources visible; no sensitive credentials.
2. **Select Credentials** — staff can grant approved named supplier logins after defined requirements.
3. **Full Access** — staff sign-off gives broader access.

Do **not** set a blanket rule that completing any course automatically unlocks every supplier. Instead, make unlock rules configurable per collection / supplier and keep the final privilege decision auditable.

### Events, recordings and Community

- A live Academy session is created using the existing agent-facing calendar event with category **Training** or **Supplier Event**.
- Agents RSVP in the existing event flow; staff retain the RSVP list.
- After the session, staff add a recording / follow-up lesson and link it to the event.
- The optional Community post remains useful for discussion and announcements, but the Academy becomes the durable home for the curriculum and completion record.

### Reminders

Use **application-native scheduled tasks**, not detached platform reminders:

- Assignment email and in-app notification on enrolment
- Nudge at configurable intervals only for incomplete required learning
- “Due soon” and “overdue” notifications where a due date exists
- Digest for staff covering overdue requirements and items awaiting review

Recommended starting defaults are **7 days after enrolment**, **3 days before due date**, and **weekly thereafter** until completion — all editable before launch.

---

## 7. Data model and technical outline

The Academy needs its own data rather than overloading Community posts or calendar records. A sensible first model is:

| Table / concept | Purpose |
|---|---|
| `academy_courses` | Collection metadata, audience, required status, publication state, current version |
| `academy_modules` | Ordered sections within a course |
| `academy_lessons` | Ordered content blocks; type, content, video URL, attachment references, estimated time |
| `academy_assessments` | Pass mark and behaviour for a lesson or module knowledge check |
| `academy_questions` | Question bank and answer options; stored safely without exposing answers to the client |
| `academy_enrolments` | Agent-to-course assignment, due date, status, completion date and current version |
| `academy_lesson_progress` | Start, completion, acknowledgement and last-viewed state |
| `academy_attempts` | Assessment score, pass/fail, answer summary and attempt timestamp |
| `academy_evidence` | Optional practical task submission / attachment and staff review state |
| `academy_access_rules` | Explicit configuration connecting a completion state to eligibility for a training stage or supplier-access review |
| `academy_audit_log` | Immutable staff / system record for publishing, enrolment, completion, override and access decisions |

### Security and privacy requirements

- Agents can access only their own enrolments, attempts and evidence.
- Answer keys, internal staff notes and other agents’ information never reach agent API responses.
- Course publication and required-status changes are restricted to Admin / Super Admin.
- Supplier credentials remain hidden behind existing access checks.
- All promotions, overrides and access decisions receive an audit entry.
- Documents use controlled storage paths and server-side authorisation, as with the Portal’s existing secure uploads.

### Delivery architecture

This fits the current React + tRPC + Drizzle + MySQL portal stack:

- New `academy` tRPC router rather than expanding unrelated routers
- Dedicated database tables and additive migration(s)
- S3-backed attachments using existing storage patterns
- Existing notification and email infrastructure for enrolment / reminder messages
- Existing calendar and Community APIs linked by IDs, not copied data
- Application-owned scheduled reminder job alongside the current Portal scheduler

---

## 8. Phased delivery plan

### Phase 1 — Minimum valuable Academy

**Goal:** replace the “Training portal login coming soon” experience with a real, managed core programme.

- Academy agent home and navigation
- One required Starter Pathway
- Admin course / module / lesson management
- Rich text, video links and downloadable resources
- Agent progress and acknowledgements
- Simple quiz builder and pass mark
- Enrol new agents automatically after onboarding approval, with manual enrolment option
- CRM progress view and staff completion overrides with reason
- Starter completion → **ready for Agent Accelerator review**
- Basic email and in-app enrolment / due reminders
- Existing calendar sessions surfaced in Academy home

**Phase 1 deliberately excludes:** certificates, external video hosting, sophisticated branching, selling courses, community discussions inside lessons, and automatic universal supplier-access unlocks.

### Phase 2 — Operational control and deeper learning

**Goal:** make it a real operational programme rather than a content library.

- Practical tasks / evidence submission and staff review queue
- Configurable prerequisites and course rules
- Versioned compliance learning and re-acknowledgements
- Supplier-specific learning collections linked to specific access requests
- Training / Accelerator / Accredited dashboard and cohort reporting
- Recording attached to past live sessions
- Configurable nudges and escalation to staff tasks
- Better search and filters across learning resources

### Phase 3 — Differentiation and scale

**Goal:** support an expanding agent business without creating admin overhead.

- Learning plans by agent goal / business focus
- Optional badges and achievement timeline
- Curated “recommended next” learning based on stage, activity and supplier access
- Advanced assessment question pools and time-bound re-certification
- Manager / team-lead view if JLT wants team leaders to support their own members
- Exportable completion and evidence report for operational or contractual records

---

## 9. Decisions to make before build

These choices materially affect the build. The following are the recommended defaults.

| Decision | Recommended default | Why |
|---|---|---|
| **Who sees it?** | All active agents, with Starter Pathway automatically assigned to newly approved members | Keeps the Academy useful beyond onboarding |
| **Where does it sit?** | Main agent navigation as **Academy**, not buried inside Community | Makes it a core operational product |
| **Initial content** | Build structure plus one high-quality required Starter Pathway first | Avoids a polished empty library |
| **Video approach** | Continue using authorised Loom / video links initially | Avoids the cost and migration effort of hosting a video platform in Phase 1 |
| **Pass mark** | 80%, with retakes allowed | Clear but not punitive |
| **Stage promotions** | Completion creates *ready for review*; staff approve Training → Accelerator and Accelerator → Accredited | Protects standards and handles exceptions |
| **Supplier access** | Link selected modules to eligibility, but require an explicit staff decision | Avoids over-broad automatic credential release |
| **Migration from LearnWorlds** | Keep legacy records as an imported / historical completion note rather than trying to replicate every historical click | Provides continuity without a costly data-cleaning project |
| **Certificates** | Defer to Phase 3 | They add presentation value but do not solve the Phase 1 control problem |

---

## 10. Suggested launch curriculum and content preparation

Before or alongside Phase 1 development, JLT should collect the actual first-course assets into a simple working pack:

1. Module title and purpose
2. Lesson outline and owner
3. Video or written content link
4. Downloadable checklist / template (if any)
5. 3–8 knowledge-check questions
6. Required status and due expectation
7. The exact operational outcome — acknowledge only, pass assessment, submit task, or staff approval

The first Starter Pathway should contain **7 modules, approximately 20–30 compact lessons**, rather than a few long recordings. This is easier to complete, update and measure.

---

## 11. Success measures

The Academy should be judged by behaviour and operational quality, not just logins:

- % of new agents completing the Starter Pathway within the target period
- Time from enrolment to first approved booking / first commission-ready file
- Fewer preventable booking, amendment, refund and commission errors for Training-stage agents
- % of supplier-access requests backed by required learning completion
- Live-session RSVP and attendance trend
- Completion rate by module — identifying confusing or overly long lessons
- Staff time spent chasing manual training status before vs. after launch

---

## 12. Recommended next step

Proceed with **Phase 1**, but first agree the Starter Pathway curriculum and the two gated outcomes:

1. What should completion of Starter Pathway allow an agent to do?
2. What must remain staff-approved?

Once those are agreed, the build can begin with the course-management foundation and a content-ready Starter Pathway. The existing “Training Hub” onboarding wording can then be replaced with a direct, controlled **JLT Academy** enrolment flow.
