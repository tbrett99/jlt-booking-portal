# Consumer Website Rollout Record

## Production schema verification

On **11 September 2026**, the additive consumer-site schema was applied to the existing Railway MySQL database that powers the JLT Booking Portal. The database now contains the following dedicated public-site tables: `public_agent_profiles`, `public_speciality_tags`, `public_agent_profile_tags`, `public_agent_profile_changes`, `public_enquiries`, and `public_partner_profiles`.

The verified secondary indexes are `public_agent_profile_changes_profile_idx`, `public_agent_profile_tags_tag_idx`, `public_agent_profiles_published_idx`, `public_agent_profiles_town_idx`, `public_enquiries_profile_idx`, `public_enquiries_rate_limit_idx`, and `public_speciality_tags_active_idx`. The relevant uniqueness safeguards on profiles, public slugs, tags, partner slugs, and profile/tag mappings were also confirmed.

## Release state

The consumer-site code is pushed to the existing `tbrett99/jlt-booking-portal` repository on `main` at commit `6148250`. The initial consumer route is available at `/consumer` on the shared application while the public domain is being connected.

| Area | Release state |
|---|---|
| Public consumer pages | Implemented and deployed with host-aware routing |
| Public profile publication | Staff review and approval required |
| Status protection | Only Active agents can be publicly visible; In Notice, In Contract, suspended, paused, and cancelled profiles are hidden |
| Agent information | Contact details remain private; public forms deliver directly to the approved private address |
| Directory discovery | Controlled destination/travel-type tags and town-level map/list experience implemented |
| Partners | Empty protected placeholder ready for an approved future supplier/partner list |

## Final launch steps

1. Point both `thejltgroup.co.uk` and `www.thejltgroup.co.uk` at the production application, keeping `www.thejltgroup.co.uk` as the canonical public host.
2. Ensure `portal.thejltgroup.co.uk` continues to point to the same application, where portal routes are protected from public indexing.
3. Staff should add the first controlled speciality tags, then ask one Active agent to complete the **My Public Profile** draft and submit it for review.
4. An admin or super admin should approve and publish that first profile, check its public page and contact-form delivery, then invite further agents to submit drafts.
5. Publish suppliers and partners only after the curated list, approved imagery/logos, and copy have been agreed.
6. Obtain final business/compliance approval of all public protection wording against current PTS and ATOL arrangements before marketing the public site.
