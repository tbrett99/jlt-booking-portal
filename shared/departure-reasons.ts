export const DEPARTURE_REASON_KEYS = [
  "financial_pressure",
  "not_enough_time",
  "personal_or_family_circumstances",
  "health_or_wellbeing",
  "returning_to_employment_or_career_change",
  "moving_to_another_travel_business",
  "business_expectations_not_met",
  "support_or_training_needs",
  "systems_or_supplier_concerns",
  "retiring",
  "other",
] as const;

export type DepartureReasonKey = typeof DEPARTURE_REASON_KEYS[number];

export const DEPARTURE_REASON_LABELS: Record<DepartureReasonKey, string> = {
  financial_pressure: "Financial pressure / cost of membership",
  not_enough_time: "Not enough time to run the business",
  personal_or_family_circumstances: "Personal or family circumstances",
  health_or_wellbeing: "Health or wellbeing",
  returning_to_employment_or_career_change: "Returning to employment / career change",
  moving_to_another_travel_business: "Moving to another travel business",
  business_expectations_not_met: "Business expectations not met",
  support_or_training_needs: "Support or training needs",
  systems_or_supplier_concerns: "Systems or supplier concerns",
  retiring: "Retiring",
  other: "Other",
};

export const DEPARTURE_REASON_OPTIONS = DEPARTURE_REASON_KEYS.map((key) => ({
  key,
  label: DEPARTURE_REASON_LABELS[key],
}));
