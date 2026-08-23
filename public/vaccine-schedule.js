// CDC/ACIP recommended child immunization schedule, birth through 24 months.
// Generic public-health reference data - no personal content belongs in this
// file. Pure data, no DOM or window references, so the server can read it with
// the `new Function` trick used for growth-curves.js (see server/growth.js) if
// vaccination reminders are ever added.
//
// Fields:
//   vaccine    stable lower-case code, stored on the event row
//   dose_num   which dose in the series (null for repeatable items)
//   name       short label (what a shot record calls it)
//   fullName   spelled-out name
//   window     ages in months: earliest = minimum age ACIP allows,
//              recommended = the routine visit, latest = end of the routine
//              range (past it the row reads as overdue; catch-up is still
//              possible and is a conversation with the pediatrician)
//   note       optional caveat the UI shows under the row
//   repeatable optional; given more than once on no fixed dose count
//   seasonal   optional; eligibility depends on the RSV season, not just age
//
// Source: cdc.gov/vaccines/schedules (child & adolescent immunization
// schedule). This is a convenience copy for tracking, not medical advice -
// the pediatrician's record is authoritative.
const VACCINE_SCHEDULE = [
  // ---- Hepatitis B ----
  { vaccine: 'hepb', dose_num: 1, name: 'HepB', fullName: 'Hepatitis B', window: { earliest: 0, recommended: 0, latest: 2 }, note: 'Within 24 hours of birth' },
  { vaccine: 'hepb', dose_num: 2, name: 'HepB', fullName: 'Hepatitis B', window: { earliest: 1, recommended: 1, latest: 2 }, note: 'Age 1-2 months' },
  { vaccine: 'hepb', dose_num: 3, name: 'HepB', fullName: 'Hepatitis B', window: { earliest: 6, recommended: 6, latest: 18 } },

  // ---- Rotavirus ----
  { vaccine: 'rv', dose_num: 1, name: 'RV', fullName: 'Rotavirus', window: { earliest: 1.5, recommended: 2, latest: 3.5 }, note: 'First dose must be given before 15 weeks' },
  { vaccine: 'rv', dose_num: 2, name: 'RV', fullName: 'Rotavirus', window: { earliest: 3, recommended: 4, latest: 5.5 } },
  { vaccine: 'rv', dose_num: 3, name: 'RV', fullName: 'Rotavirus', window: { earliest: 5, recommended: 6, latest: 8 }, note: 'RotaTeq (RV5) only - Rotarix (RV1) is a 2-dose series. Series must finish by 8 months' },

  // ---- DTaP ----
  { vaccine: 'dtap', dose_num: 1, name: 'DTaP', fullName: 'Diphtheria, tetanus & pertussis', window: { earliest: 1.5, recommended: 2, latest: 3 } },
  { vaccine: 'dtap', dose_num: 2, name: 'DTaP', fullName: 'Diphtheria, tetanus & pertussis', window: { earliest: 3, recommended: 4, latest: 5 } },
  { vaccine: 'dtap', dose_num: 3, name: 'DTaP', fullName: 'Diphtheria, tetanus & pertussis', window: { earliest: 5, recommended: 6, latest: 7 } },
  { vaccine: 'dtap', dose_num: 4, name: 'DTaP', fullName: 'Diphtheria, tetanus & pertussis', window: { earliest: 12, recommended: 15, latest: 18 }, note: 'At least 6 months after dose 3' },

  // ---- Hib ----
  { vaccine: 'hib', dose_num: 1, name: 'Hib', fullName: 'Haemophilus influenzae type b', window: { earliest: 1.5, recommended: 2, latest: 3 } },
  { vaccine: 'hib', dose_num: 2, name: 'Hib', fullName: 'Haemophilus influenzae type b', window: { earliest: 3, recommended: 4, latest: 5 } },
  { vaccine: 'hib', dose_num: 3, name: 'Hib', fullName: 'Haemophilus influenzae type b', window: { earliest: 5, recommended: 6, latest: 7 }, note: 'Only for the 4-dose brands (ActHIB, Hiberix, Pentacel) - PedvaxHIB is a 3-dose series with no 6-month dose' },
  { vaccine: 'hib', dose_num: 4, name: 'Hib', fullName: 'Haemophilus influenzae type b', window: { earliest: 12, recommended: 12, latest: 15 }, note: 'Booster' },

  // ---- Pneumococcal conjugate ----
  { vaccine: 'pcv', dose_num: 1, name: 'PCV', fullName: 'Pneumococcal conjugate', window: { earliest: 1.5, recommended: 2, latest: 3 } },
  { vaccine: 'pcv', dose_num: 2, name: 'PCV', fullName: 'Pneumococcal conjugate', window: { earliest: 3, recommended: 4, latest: 5 } },
  { vaccine: 'pcv', dose_num: 3, name: 'PCV', fullName: 'Pneumococcal conjugate', window: { earliest: 5, recommended: 6, latest: 7 } },
  { vaccine: 'pcv', dose_num: 4, name: 'PCV', fullName: 'Pneumococcal conjugate', window: { earliest: 12, recommended: 12, latest: 15 }, note: 'Booster' },

  // ---- Polio ----
  { vaccine: 'ipv', dose_num: 1, name: 'IPV', fullName: 'Polio', window: { earliest: 1.5, recommended: 2, latest: 3 } },
  { vaccine: 'ipv', dose_num: 2, name: 'IPV', fullName: 'Polio', window: { earliest: 3, recommended: 4, latest: 5 } },
  { vaccine: 'ipv', dose_num: 3, name: 'IPV', fullName: 'Polio', window: { earliest: 6, recommended: 6, latest: 18 }, note: 'A 4th dose follows at 4-6 years' },

  // ---- Influenza ----
  {
    vaccine: 'flu',
    dose_num: null,
    name: 'Flu',
    fullName: 'Influenza',
    repeatable: true,
    window: { earliest: 6, recommended: 6, latest: 24 },
    note: 'Every year from 6 months. The first flu season needs 2 doses at least 4 weeks apart',
  },

  // ---- MMR ----
  { vaccine: 'mmr', dose_num: 1, name: 'MMR', fullName: 'Measles, mumps & rubella', window: { earliest: 12, recommended: 12, latest: 15 }, note: 'A 2nd dose follows at 4-6 years' },

  // ---- Varicella ----
  { vaccine: 'var', dose_num: 1, name: 'Varicella', fullName: 'Chickenpox', window: { earliest: 12, recommended: 12, latest: 15 }, note: 'A 2nd dose follows at 4-6 years' },

  // ---- Hepatitis A ----
  { vaccine: 'hepa', dose_num: 1, name: 'HepA', fullName: 'Hepatitis A', window: { earliest: 12, recommended: 12, latest: 23 } },
  { vaccine: 'hepa', dose_num: 2, name: 'HepA', fullName: 'Hepatitis A', window: { earliest: 18, recommended: 18, latest: 24 }, note: 'At least 6 months after dose 1' },

  // ---- RSV monoclonal antibody ----
  // Not a vaccine (a monoclonal antibody), but it is given at well visits and
  // parents track it alongside the shots.
  {
    vaccine: 'rsv-nirsevimab',
    dose_num: 1,
    name: 'RSV',
    fullName: 'RSV antibody (nirsevimab)',
    seasonal: true,
    window: { earliest: 0, recommended: 0, latest: 8 },
    note: 'Seasonal: for infants under 8 months entering their first RSV season (roughly October-March), unless the birth parent had the RSV vaccine in pregnancy',
  },
]

// Typical well-visit ages in months; checklist rows group under these.
const VACCINE_VISITS = [0, 1, 2, 4, 6, 12, 15, 18]

// Human label for a visit group.
const VACCINE_VISIT_LABELS = {
  0: 'Birth',
  1: '1 month',
  2: '2 months',
  4: '4 months',
  6: '6 months',
  12: '12 months',
  15: '15 months',
  18: '18 months',
}
