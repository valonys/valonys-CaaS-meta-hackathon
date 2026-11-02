// Inspection valuation-code map, copied unchanged from the ValonyLabs CaaS repo
// (frontend/lib/inspection-code-map.json at e6155c4). Code = <2-digit condition><2-letter class>;
// severity follows the condition digit: 00 unknown, 01 low, 02 medium, 03 high, 04 critical.
// Kept as a TS module so both Next and the node test runner load it without JSON import attributes.
export const INSPECTION_CODES: Record<string, { cond: string; suffix: string; sev: "unknown" | "low" | "medium" | "high" | "critical"; desc: string; mech: string }> = {
 "00ND": {
  "cond": "00",
  "suffix": "ND",
  "sev": "unknown",
  "desc": "Inspection Not Done/not inspectable",
  "mech": "Not done"
 },
 "01AQ": {
  "cond": "01",
  "suffix": "AQ",
  "sev": "low",
  "desc": "Anode in good condition",
  "mech": "Anode condition"
 },
 "02AD": {
  "cond": "02",
  "suffix": "AD",
  "sev": "medium",
  "desc": "Minor Depletion / Damage",
  "mech": "Anode depletion"
 },
 "03AD": {
  "cond": "03",
  "suffix": "AD",
  "sev": "high",
  "desc": "Major Depletion / Plan to refurbish",
  "mech": "Anode depletion"
 },
 "04AD": {
  "cond": "04",
  "suffix": "AD",
  "sev": "critical",
  "desc": "Mostly depleted / Immediate refurbish",
  "mech": "Anode depletion"
 },
 "01CV": {
  "cond": "01",
  "suffix": "CV",
  "sev": "low",
  "desc": "Certificate Valid-No Action Required",
  "mech": "Certificate"
 },
 "02CE": {
  "cond": "02",
  "suffix": "CE",
  "sev": "medium",
  "desc": "Certificate soon to expire-Recertify",
  "mech": "Certificate"
 },
 "03CN": {
  "cond": "03",
  "suffix": "CN",
  "sev": "high",
  "desc": "Certificate NOT Valid-Recertify",
  "mech": "Certificate"
 },
 "01NF": {
  "cond": "01",
  "suffix": "NF",
  "sev": "low",
  "desc": "Good condition - No action required",
  "mech": "No notable defect"
 },
 "02CC": {
  "cond": "02",
  "suffix": "CC",
  "sev": "medium",
  "desc": "Slightly corroded clamp",
  "mech": "Clamp corrosion"
 },
 "03LC": {
  "cond": "03",
  "suffix": "LC",
  "sev": "high",
  "desc": "Loosen clamp - to retighten",
  "mech": "Loose clamp"
 },
 "04MC": {
  "cond": "04",
  "suffix": "MC",
  "sev": "critical",
  "desc": "Missing clamp - to re-install",
  "mech": "Missing clamp"
 },
 "01NT": {
  "cond": "01",
  "suffix": "NT",
  "sev": "low",
  "desc": "Good coating condition (Ri0)",
  "mech": "Coating"
 },
 "02CO": {
  "cond": "02",
  "suffix": "CO",
  "sev": "medium",
  "desc": "Minor coating damage (Ri2-Ri1)",
  "mech": "Coating breakdown"
 },
 "03CO": {
  "cond": "03",
  "suffix": "CO",
  "sev": "high",
  "desc": "Significant coating damage (Ri4-Ri3)",
  "mech": "Coating breakdown"
 },
 "04CO": {
  "cond": "04",
  "suffix": "CO",
  "sev": "critical",
  "desc": "Major coating damage (Ri5)",
  "mech": "Coating breakdown"
 },
 "01CP": {
  "cond": "01",
  "suffix": "CP",
  "sev": "low",
  "desc": "CP in good condition",
  "mech": "Cathodic protection"
 },
 "02CF": {
  "cond": "02",
  "suffix": "CF",
  "sev": "medium",
  "desc": "Impressed Current Fault",
  "mech": "Impressed current fault"
 },
 "02LA": {
  "cond": "02",
  "suffix": "LA",
  "sev": "medium",
  "desc": "Level Anomaly (Under/Over Protection)",
  "mech": "Protection level"
 },
 "02TP": {
  "cond": "02",
  "suffix": "TP",
  "sev": "medium",
  "desc": "Test Point Defective",
  "mech": "Test point"
 },
 "03CF": {
  "cond": "03",
  "suffix": "CF",
  "sev": "high",
  "desc": "Impressed Current Fault",
  "mech": "Impressed current fault"
 },
 "03LA": {
  "cond": "03",
  "suffix": "LA",
  "sev": "high",
  "desc": "Some Pts under/over protection level",
  "mech": "Protection level"
 },
 "03TP": {
  "cond": "03",
  "suffix": "TP",
  "sev": "high",
  "desc": "Some Test Points Defective",
  "mech": "Test point"
 },
 "04CF": {
  "cond": "04",
  "suffix": "CF",
  "sev": "critical",
  "desc": "Impressed Current Fault",
  "mech": "Impressed current fault"
 },
 "04LA": {
  "cond": "04",
  "suffix": "LA",
  "sev": "critical",
  "desc": "All Points under/over protection level",
  "mech": "Protection level"
 },
 "04TP": {
  "cond": "04",
  "suffix": "TP",
  "sev": "critical",
  "desc": "All Test Points Defective",
  "mech": "Test point"
 },
 "01CL": {
  "cond": "01",
  "suffix": "CL",
  "sev": "low",
  "desc": "Clean",
  "mech": "Cleanliness"
 },
 "02CT": {
  "cond": "02",
  "suffix": "CT",
  "sev": "medium",
  "desc": "Clogged/Plugged",
  "mech": "Clogging/blockage"
 },
 "02DD": {
  "cond": "02",
  "suffix": "DD",
  "sev": "medium",
  "desc": "Debris/Deposits (sand, sludge, wax, .)",
  "mech": "Debris/deposits"
 },
 "02SC": {
  "cond": "02",
  "suffix": "SC",
  "sev": "medium",
  "desc": "Scales",
  "mech": "Scaling"
 },
 "03CT": {
  "cond": "03",
  "suffix": "CT",
  "sev": "high",
  "desc": "Clogged/Plugged",
  "mech": "Clogging/blockage"
 },
 "03DD": {
  "cond": "03",
  "suffix": "DD",
  "sev": "high",
  "desc": "Debris/Deposits (sand, sludge, wax, .)",
  "mech": "Debris/deposits"
 },
 "03SC": {
  "cond": "03",
  "suffix": "SC",
  "sev": "high",
  "desc": "Scales",
  "mech": "Scaling"
 },
 "04CT": {
  "cond": "04",
  "suffix": "CT",
  "sev": "critical",
  "desc": "Clogged/Plugged",
  "mech": "Clogging/blockage"
 },
 "04DD": {
  "cond": "04",
  "suffix": "DD",
  "sev": "critical",
  "desc": "Debris/Deposits (sand, sludge, wax, .)",
  "mech": "Debris/deposits"
 },
 "04SC": {
  "cond": "04",
  "suffix": "SC",
  "sev": "critical",
  "desc": "Scales",
  "mech": "Scaling"
 },
 "02MA": {
  "cond": "02",
  "suffix": "MA",
  "sev": "medium",
  "desc": "Minor anomaly - No action",
  "mech": "General anomaly"
 },
 "03MA": {
  "cond": "03",
  "suffix": "MA",
  "sev": "high",
  "desc": "Major anomaly - Planned action",
  "mech": "General anomaly"
 },
 "04BW": {
  "cond": "04",
  "suffix": "BW",
  "sev": "critical",
  "desc": "Broken wires etc - Immediate action",
  "mech": "Bellows/wires"
 },
 "01BH": {
  "cond": "01",
  "suffix": "BH",
  "sev": "low",
  "desc": "Test result OK",
  "mech": "Test result OK"
 },
 "03BH": {
  "cond": "03",
  "suffix": "BH",
  "sev": "high",
  "desc": "Test result not OK",
  "mech": "Test result not OK"
 },
 "04BH": {
  "cond": "04",
  "suffix": "BH",
  "sev": "critical",
  "desc": "Test result not OK",
  "mech": "Test result not OK"
 },
 "01AE": {
  "cond": "01",
  "suffix": "AE",
  "sev": "low",
  "desc": "All element/component in good condit.",
  "mech": "All element/component in"
 },
 "02IN": {
  "cond": "02",
  "suffix": "IN",
  "sev": "medium",
  "desc": "Minor mechanical damage",
  "mech": "Internals damage"
 },
 "03IN": {
  "cond": "03",
  "suffix": "IN",
  "sev": "high",
  "desc": "Sealing and mechanical damage",
  "mech": "Internals damage"
 },
 "04IN": {
  "cond": "04",
  "suffix": "IN",
  "sev": "critical",
  "desc": "Sections loose / disconnected & open to elements",
  "mech": "Internals damage"
 },
 "00IN": {
  "cond": "00",
  "suffix": "IN",
  "sev": "unknown",
  "desc": "Audit not done (Item not Available)",
  "mech": "Internals damage"
 },
 "01DA": {
  "cond": "01",
  "suffix": "DA",
  "sev": "low",
  "desc": "Supporting Document available",
  "mech": "Supporting Document avai"
 },
 "01IF": {
  "cond": "01",
  "suffix": "IF",
  "sev": "low",
  "desc": "Equipment Fit For use",
  "mech": "Equipment Fit For use"
 },
 "01IG": {
  "cond": "01",
  "suffix": "IG",
  "sev": "low",
  "desc": "Item in Good Condition",
  "mech": "Item in Good Condition"
 },
 "02EC": {
  "cond": "02",
  "suffix": "EC",
  "sev": "medium",
  "desc": "Equipment fit for use with condition",
  "mech": "Equipment fit for use wi"
 },
 "02IS": {
  "cond": "02",
  "suffix": "IS",
  "sev": "medium",
  "desc": "Item Servicable",
  "mech": "Item Servicable"
 },
 "03DN": {
  "cond": "03",
  "suffix": "DN",
  "sev": "high",
  "desc": "Supporting Document NOT available",
  "mech": "Supporting Document NOT "
 },
 "04EN": {
  "cond": "04",
  "suffix": "EN",
  "sev": "critical",
  "desc": "Equipment not fit for use",
  "mech": "Equipment not fit for us"
 },
 "04IS": {
  "cond": "04",
  "suffix": "IS",
  "sev": "critical",
  "desc": "Item POOR condition (to be replaced)",
  "mech": "Item POOR condition (to "
 },
 "00NU": {
  "cond": "00",
  "suffix": "NU",
  "sev": "unknown",
  "desc": "Equipment Not Found",
  "mech": "Equipment Not Found"
 },
 "01FT": {
  "cond": "01",
  "suffix": "FT",
  "sev": "low",
  "desc": "Equipment/Appliance PASSED Inspection",
  "mech": "Equipment/Appliance PASS"
 },
 "02LF": {
  "cond": "02",
  "suffix": "LF",
  "sev": "medium",
  "desc": "Equipment/Appliance Damaged",
  "mech": "Equipment/Appliance Dama"
 },
 "03LF": {
  "cond": "03",
  "suffix": "LF",
  "sev": "high",
  "desc": "Equipment/Appliance Damaged",
  "mech": "Equipment/Appliance Dama"
 },
 "04NP": {
  "cond": "04",
  "suffix": "NP",
  "sev": "critical",
  "desc": "Equipmnt/Applnce NOT PASSED Inspection",
  "mech": "Equipmnt/Applnce NOT PAS"
 },
 "01NG": {
  "cond": "01",
  "suffix": "NG",
  "sev": "low",
  "desc": "No marine growth",
  "mech": "Marine growth"
 },
 "02AG": {
  "cond": "02",
  "suffix": "AG",
  "sev": "medium",
  "desc": "Acceptable (no cleaning required)",
  "mech": "Air gap"
 },
 "03NG": {
  "cond": "03",
  "suffix": "NG",
  "sev": "high",
  "desc": "Nearly limit (cleaning in < one year)",
  "mech": "Marine growth"
 },
 "04OG": {
  "cond": "04",
  "suffix": "OG",
  "sev": "critical",
  "desc": "Over limit (immediate cleaning)",
  "mech": "Over limit (immediate cl"
 },
 "00MR": {
  "cond": "00",
  "suffix": "MR",
  "sev": "unknown",
  "desc": "Not Seen",
  "mech": "Not Seen"
 },
 "01MR": {
  "cond": "01",
  "suffix": "MR",
  "sev": "low",
  "desc": "Yes",
  "mech": "Yes"
 },
 "02MR": {
  "cond": "02",
  "suffix": "MR",
  "sev": "medium",
  "desc": "No - Priority 3",
  "mech": "No - Priority 3"
 },
 "03MR": {
  "cond": "03",
  "suffix": "MR",
  "sev": "high",
  "desc": "No - Priority 2",
  "mech": "No - Priority 2"
 },
 "04MP": {
  "cond": "04",
  "suffix": "MP",
  "sev": "critical",
  "desc": "No",
  "mech": "No"
 },
 "04MR": {
  "cond": "04",
  "suffix": "MR",
  "sev": "critical",
  "desc": "No - Priority 1",
  "mech": "No - Priority 1"
 },
 "02ED": {
  "cond": "02",
  "suffix": "ED",
  "sev": "medium",
  "desc": "Erroneous data",
  "mech": "Erroneous data"
 },
 "02ID": {
  "cond": "02",
  "suffix": "ID",
  "sev": "medium",
  "desc": "Lack of Identification/marking",
  "mech": "Identification/marking"
 },
 "03ED": {
  "cond": "03",
  "suffix": "ED",
  "sev": "high",
  "desc": "Erroneous data",
  "mech": "Erroneous data"
 },
 "03ID": {
  "cond": "03",
  "suffix": "ID",
  "sev": "high",
  "desc": "Lack of Identification/marking",
  "mech": "Identification/marking"
 },
 "04ED": {
  "cond": "04",
  "suffix": "ED",
  "sev": "critical",
  "desc": "Erroneous data",
  "mech": "Erroneous data"
 },
 "04ID": {
  "cond": "04",
  "suffix": "ID",
  "sev": "critical",
  "desc": "Lack of Identification/marking",
  "mech": "Identification/marking"
 },
 "04BP": {
  "cond": "04",
  "suffix": "BP",
  "sev": "critical",
  "desc": "Significant anomaly (Blocked Pig)",
  "mech": "Significant anomaly (Blo"
 },
 "04TL": {
  "cond": "04",
  "suffix": "TL",
  "sev": "critical",
  "desc": "Crack or wall loss > 80%",
  "mech": "Crack or wall loss > 80%"
 },
 "01JB": {
  "cond": "01",
  "suffix": "JB",
  "sev": "low",
  "desc": "Good condition-No action required",
  "mech": "Good condition-No action"
 },
 "02DT": {
  "cond": "02",
  "suffix": "DT",
  "sev": "medium",
  "desc": "Displacement",
  "mech": "Displacement"
 },
 "02EM": {
  "cond": "02",
  "suffix": "EM",
  "sev": "medium",
  "desc": "Embedment",
  "mech": "Embedment"
 },
 "02FP": {
  "cond": "02",
  "suffix": "FP",
  "sev": "medium",
  "desc": "Free-span",
  "mech": "Free-span"
 },
 "02MV": {
  "cond": "02",
  "suffix": "MV",
  "sev": "medium",
  "desc": "Movement/Vibration",
  "mech": "Movement/vibration"
 },
 "03DT": {
  "cond": "03",
  "suffix": "DT",
  "sev": "high",
  "desc": "Displacement",
  "mech": "Displacement"
 },
 "03EM": {
  "cond": "03",
  "suffix": "EM",
  "sev": "high",
  "desc": "Embedment",
  "mech": "Embedment"
 },
 "03FP": {
  "cond": "03",
  "suffix": "FP",
  "sev": "high",
  "desc": "Free-span",
  "mech": "Free-span"
 },
 "03MV": {
  "cond": "03",
  "suffix": "MV",
  "sev": "high",
  "desc": "Movement/Vibration",
  "mech": "Movement/vibration"
 },
 "04DT": {
  "cond": "04",
  "suffix": "DT",
  "sev": "critical",
  "desc": "Displacement",
  "mech": "Displacement"
 },
 "04EM": {
  "cond": "04",
  "suffix": "EM",
  "sev": "critical",
  "desc": "Embedment",
  "mech": "Embedment"
 },
 "04FP": {
  "cond": "04",
  "suffix": "FP",
  "sev": "critical",
  "desc": "Free-span",
  "mech": "Free-span"
 },
 "04MV": {
  "cond": "04",
  "suffix": "MV",
  "sev": "critical",
  "desc": "Movement/Vibration",
  "mech": "Movement/vibration"
 },
 "01BG": {
  "cond": "01",
  "suffix": "BG",
  "sev": "low",
  "desc": "Body in good condition",
  "mech": "Body condition"
 },
 "02BE": {
  "cond": "02",
  "suffix": "BE",
  "sev": "medium",
  "desc": "Body externally damaged/corroded",
  "mech": "External corrosion"
 },
 "02BI": {
  "cond": "02",
  "suffix": "BI",
  "sev": "medium",
  "desc": "Body internally damaged/corroded",
  "mech": "Internal corrosion"
 },
 "03BE": {
  "cond": "03",
  "suffix": "BE",
  "sev": "high",
  "desc": "Body externally damaged/corroded",
  "mech": "External corrosion"
 },
 "03BI": {
  "cond": "03",
  "suffix": "BI",
  "sev": "high",
  "desc": "Body internally damaged/corroded",
  "mech": "Internal corrosion"
 },
 "04BE": {
  "cond": "04",
  "suffix": "BE",
  "sev": "critical",
  "desc": "Body externally damaged/corroded",
  "mech": "External corrosion"
 },
 "04BI": {
  "cond": "04",
  "suffix": "BI",
  "sev": "critical",
  "desc": "Body internally damaged/corroded",
  "mech": "Internal corrosion"
 },
 "01ST": {
  "cond": "01",
  "suffix": "ST",
  "sev": "low",
  "desc": "Good condition",
  "mech": "Structural damage"
 },
 "02ST": {
  "cond": "02",
  "suffix": "ST",
  "sev": "medium",
  "desc": "Minor anomaly",
  "mech": "Structural damage"
 },
 "03ST": {
  "cond": "03",
  "suffix": "ST",
  "sev": "high",
  "desc": "Significant damage",
  "mech": "Structural damage"
 },
 "04ST": {
  "cond": "04",
  "suffix": "ST",
  "sev": "critical",
  "desc": "Major Damage",
  "mech": "Structural damage"
 },
 "02DS": {
  "cond": "02",
  "suffix": "DS",
  "sev": "medium",
  "desc": "Disc damaged/corroded",
  "mech": "Disc"
 },
 "02MI": {
  "cond": "02",
  "suffix": "MI",
  "sev": "medium",
  "desc": "Miscellaneous parts condition",
  "mech": "Miscellaneous parts cond"
 },
 "02NO": {
  "cond": "02",
  "suffix": "NO",
  "sev": "medium",
  "desc": "Nozzle damaged/corroded",
  "mech": "Nozzle"
 },
 "02SG": {
  "cond": "02",
  "suffix": "SG",
  "sev": "medium",
  "desc": "Spring damaged/corroded",
  "mech": "Spring"
 },
 "03BU": {
  "cond": "03",
  "suffix": "BU",
  "sev": "high",
  "desc": "Burst disc damaged/corroded",
  "mech": "Burst disc"
 },
 "03BW": {
  "cond": "03",
  "suffix": "BW",
  "sev": "high",
  "desc": "Bellow damaged/corroded",
  "mech": "Bellows/wires"
 },
 "03DS": {
  "cond": "03",
  "suffix": "DS",
  "sev": "high",
  "desc": "Disc damaged/corroded",
  "mech": "Disc"
 },
 "03MI": {
  "cond": "03",
  "suffix": "MI",
  "sev": "high",
  "desc": "Miscellaneous parts condition",
  "mech": "Miscellaneous parts cond"
 },
 "03NO": {
  "cond": "03",
  "suffix": "NO",
  "sev": "high",
  "desc": "Nozzle damaged/corroded",
  "mech": "Nozzle"
 },
 "03SG": {
  "cond": "03",
  "suffix": "SG",
  "sev": "high",
  "desc": "Spring damaged/corroded",
  "mech": "Spring"
 },
 "04BU": {
  "cond": "04",
  "suffix": "BU",
  "sev": "critical",
  "desc": "Burst disc damaged/corroded",
  "mech": "Burst disc"
 },
 "04DS": {
  "cond": "04",
  "suffix": "DS",
  "sev": "critical",
  "desc": "Disc damaged/corroded",
  "mech": "Disc"
 },
 "04MI": {
  "cond": "04",
  "suffix": "MI",
  "sev": "critical",
  "desc": "Miscellaneous parts condition",
  "mech": "Miscellaneous parts cond"
 },
 "04NO": {
  "cond": "04",
  "suffix": "NO",
  "sev": "critical",
  "desc": "Nozzle damaged/corroded",
  "mech": "Nozzle"
 },
 "04SG": {
  "cond": "04",
  "suffix": "SG",
  "sev": "critical",
  "desc": "Spring damaged/corroded",
  "mech": "Spring"
 },
 "01CA": {
  "cond": "01",
  "suffix": "CA",
  "sev": "low",
  "desc": "Category 1",
  "mech": "Category"
 },
 "02CA": {
  "cond": "02",
  "suffix": "CA",
  "sev": "medium",
  "desc": "Category 2",
  "mech": "Category"
 },
 "03CA": {
  "cond": "03",
  "suffix": "CA",
  "sev": "high",
  "desc": "Category 3",
  "mech": "Category"
 },
 "04CA": {
  "cond": "04",
  "suffix": "CA",
  "sev": "critical",
  "desc": "Category 4",
  "mech": "Category"
 },
 "02AC": {
  "cond": "02",
  "suffix": "AC",
  "sev": "medium",
  "desc": "PSD ancillary piping condition",
  "mech": "PSD ancillary piping con"
 },
 "02IK": {
  "cond": "02",
  "suffix": "IK",
  "sev": "medium",
  "desc": "Interlock condition",
  "mech": "Interlock condition"
 },
 "02TG": {
  "cond": "02",
  "suffix": "TG",
  "sev": "medium",
  "desc": "PSD Tagging defective",
  "mech": "PSD Tagging defective"
 },
 "02VD": {
  "cond": "02",
  "suffix": "VD",
  "sev": "medium",
  "desc": "Vent damaged/missing",
  "mech": "Vent"
 },
 "02VE": {
  "cond": "02",
  "suffix": "VE",
  "sev": "medium",
  "desc": "Vent build-up (debris)",
  "mech": "Vent build-up"
 },
 "03AC": {
  "cond": "03",
  "suffix": "AC",
  "sev": "high",
  "desc": "PSD ancillary piping condition",
  "mech": "PSD ancillary piping con"
 },
 "03IK": {
  "cond": "03",
  "suffix": "IK",
  "sev": "high",
  "desc": "Interlock condition",
  "mech": "Interlock condition"
 },
 "03RC": {
  "cond": "03",
  "suffix": "RC",
  "sev": "high",
  "desc": "Recertification overdue",
  "mech": "Recertification overdue"
 },
 "03SE": {
  "cond": "03",
  "suffix": "SE",
  "sev": "high",
  "desc": "PSD-Seal missing",
  "mech": "PSD-Seal missing"
 },
 "03TG": {
  "cond": "03",
  "suffix": "TG",
  "sev": "high",
  "desc": "PSD Tagging defective",
  "mech": "PSD Tagging defective"
 },
 "03VD": {
  "cond": "03",
  "suffix": "VD",
  "sev": "high",
  "desc": "Vent damaged/missing",
  "mech": "Vent"
 },
 "03VE": {
  "cond": "03",
  "suffix": "VE",
  "sev": "high",
  "desc": "Vent build-up (debris)",
  "mech": "Vent build-up"
 },
 "04AC": {
  "cond": "04",
  "suffix": "AC",
  "sev": "critical",
  "desc": "PSD ancillary piping condition",
  "mech": "PSD ancillary piping con"
 },
 "04ES": {
  "cond": "04",
  "suffix": "ES",
  "sev": "critical",
  "desc": "Erroneous set pressure",
  "mech": "Erroneous set pressure"
 },
 "04IK": {
  "cond": "04",
  "suffix": "IK",
  "sev": "critical",
  "desc": "Interlock condition",
  "mech": "Interlock condition"
 },
 "04RC": {
  "cond": "04",
  "suffix": "RC",
  "sev": "critical",
  "desc": "Recertification overdue",
  "mech": "Recertification overdue"
 },
 "04SE": {
  "cond": "04",
  "suffix": "SE",
  "sev": "critical",
  "desc": "PSD-Seal missing",
  "mech": "PSD-Seal missing"
 },
 "04TG": {
  "cond": "04",
  "suffix": "TG",
  "sev": "critical",
  "desc": "PSD Tagging defective",
  "mech": "PSD Tagging defective"
 },
 "04VD": {
  "cond": "04",
  "suffix": "VD",
  "sev": "critical",
  "desc": "Vent damaged/missing",
  "mech": "Vent"
 },
 "04VE": {
  "cond": "04",
  "suffix": "VE",
  "sev": "critical",
  "desc": "Vent build-up (debris)",
  "mech": "Vent build-up"
 },
 "00JA": {
  "cond": "00",
  "suffix": "JA",
  "sev": "unknown",
  "desc": "Inspection Not Done/Not inspectable",
  "mech": "Inspection Not Done/Not "
 },
 "02JC": {
  "cond": "02",
  "suffix": "JC",
  "sev": "medium",
  "desc": "Minor defect-No Corrective Action",
  "mech": "Minor defect-No Correcti"
 },
 "03JD": {
  "cond": "03",
  "suffix": "JD",
  "sev": "high",
  "desc": "Defective-Correct. Act. by spec. date",
  "mech": "Defective-Correct. Act. "
 },
 "04JE": {
  "cond": "04",
  "suffix": "JE",
  "sev": "critical",
  "desc": "Remedial action required without delay",
  "mech": "Remedial action required"
 },
 "01AG": {
  "cond": "01",
  "suffix": "AG",
  "sev": "low",
  "desc": "Air gap as installed",
  "mech": "Air gap"
 },
 "03AG": {
  "cond": "03",
  "suffix": "AG",
  "sev": "high",
  "desc": "Significant Air gap change",
  "mech": "Air gap"
 },
 "04AG": {
  "cond": "04",
  "suffix": "AG",
  "sev": "critical",
  "desc": "Major Air gap change",
  "mech": "Air gap"
 },
 "01DB": {
  "cond": "01",
  "suffix": "DB",
  "sev": "low",
  "desc": "Clean",
  "mech": "Debris/dropped object"
 },
 "02DB": {
  "cond": "02",
  "suffix": "DB",
  "sev": "medium",
  "desc": "Minor debris presence",
  "mech": "Debris/dropped object"
 },
 "03DB": {
  "cond": "03",
  "suffix": "DB",
  "sev": "high",
  "desc": "Significant debris/dropped objects",
  "mech": "Debris/dropped object"
 },
 "04DB": {
  "cond": "04",
  "suffix": "DB",
  "sev": "critical",
  "desc": "Major debris/dropped objects",
  "mech": "Debris/dropped object"
 },
 "01FM": {
  "cond": "01",
  "suffix": "FM",
  "sev": "low",
  "desc": "No flooded member",
  "mech": "Flooded member"
 },
 "02FM": {
  "cond": "02",
  "suffix": "FM",
  "sev": "medium",
  "desc": "One flooded member",
  "mech": "Flooded member"
 },
 "03FM": {
  "cond": "03",
  "suffix": "FM",
  "sev": "high",
  "desc": "Between 2 and 3 flooded members",
  "mech": "Flooded member"
 },
 "04FM": {
  "cond": "04",
  "suffix": "FM",
  "sev": "critical",
  "desc": "More than 3 flooded members",
  "mech": "Flooded member"
 },
 "00LD": {
  "cond": "00",
  "suffix": "LD",
  "sev": "unknown",
  "desc": "Inspection Not Done/Not inspectable",
  "mech": "Design change"
 },
 "01LD": {
  "cond": "01",
  "suffix": "LD",
  "sev": "low",
  "desc": "No change vs original design data",
  "mech": "Design change"
 },
 "02LD": {
  "cond": "02",
  "suffix": "LD",
  "sev": "medium",
  "desc": "Minor change vs original design",
  "mech": "Design change"
 },
 "03LD": {
  "cond": "03",
  "suffix": "LD",
  "sev": "high",
  "desc": "Significant change vs original design",
  "mech": "Design change"
 },
 "04LD": {
  "cond": "04",
  "suffix": "LD",
  "sev": "critical",
  "desc": "Major change vs original design",
  "mech": "Design change"
 },
 "01LV": {
  "cond": "01",
  "suffix": "LV",
  "sev": "low",
  "desc": "Leveling as installed",
  "mech": "Levelling"
 },
 "02LV": {
  "cond": "02",
  "suffix": "LV",
  "sev": "medium",
  "desc": "Minor Levelling within tolerance",
  "mech": "Levelling"
 },
 "03LV": {
  "cond": "03",
  "suffix": "LV",
  "sev": "high",
  "desc": "Significant Leveling outside tolerance",
  "mech": "Levelling"
 },
 "04LV": {
  "cond": "04",
  "suffix": "LV",
  "sev": "critical",
  "desc": "Major Leveling outside tolerances.",
  "mech": "Levelling"
 },
 "01WD": {
  "cond": "01",
  "suffix": "WD",
  "sev": "low",
  "desc": "No cracking or corrosion detected",
  "mech": "Weld cracking"
 },
 "02WD": {
  "cond": "02",
  "suffix": "WD",
  "sev": "medium",
  "desc": "Corrosion detected but No Cracking",
  "mech": "Weld cracking"
 },
 "03WD": {
  "cond": "03",
  "suffix": "WD",
  "sev": "high",
  "desc": "Significant Cracking-Action / due date",
  "mech": "Weld cracking"
 },
 "04WD": {
  "cond": "04",
  "suffix": "WD",
  "sev": "critical",
  "desc": "Major Cracking-Immediate Action",
  "mech": "Weld cracking"
 },
 "01VA": {
  "cond": "01",
  "suffix": "VA",
  "sev": "low",
  "desc": "Valid",
  "mech": "Validity"
 },
 "04VA": {
  "cond": "04",
  "suffix": "VA",
  "sev": "critical",
  "desc": "Not Valid",
  "mech": "Validity"
 },
 "01VB": {
  "cond": "01",
  "suffix": "VB",
  "sev": "low",
  "desc": "No vibrations/Steady state process",
  "mech": "Vibration"
 },
 "02VB": {
  "cond": "02",
  "suffix": "VB",
  "sev": "medium",
  "desc": "Vibrations possible or observed",
  "mech": "Vibration"
 },
 "03VB": {
  "cond": "03",
  "suffix": "VB",
  "sev": "high",
  "desc": "Vibrations possible or observed",
  "mech": "Vibration"
 },
 "04VB": {
  "cond": "04",
  "suffix": "VB",
  "sev": "critical",
  "desc": "Vibrations possible or observed",
  "mech": "Vibration"
 },
 "04MA": {
  "cond": "04",
  "suffix": "MA",
  "sev": "critical",
  "desc": "4-Major damage (immediate follow up)",
  "mech": "General anomaly"
 },
 "02IJ": {
  "cond": "02",
  "suffix": "IJ",
  "sev": "medium",
  "desc": "2-Damaged/Missing insulation jacketing",
  "mech": "Insulation jacketing"
 },
 "02VI": {
  "cond": "02",
  "suffix": "VI",
  "sev": "medium",
  "desc": "2-Visible subsea thermal leaks",
  "mech": "Thermal leak"
 },
 "02WI": {
  "cond": "02",
  "suffix": "WI",
  "sev": "medium",
  "desc": "2-Visible water ingress/dripping",
  "mech": "Water ingress"
 },
 "03IJ": {
  "cond": "03",
  "suffix": "IJ",
  "sev": "high",
  "desc": "3-Damaged/Missing insulation jacketing",
  "mech": "Insulation jacketing"
 },
 "03VI": {
  "cond": "03",
  "suffix": "VI",
  "sev": "high",
  "desc": "3-Visible subsea thermal leaks",
  "mech": "Thermal leak"
 },
 "03WI": {
  "cond": "03",
  "suffix": "WI",
  "sev": "high",
  "desc": "3-Visible water ingress/dripping",
  "mech": "Water ingress"
 },
 "04IJ": {
  "cond": "04",
  "suffix": "IJ",
  "sev": "critical",
  "desc": "4-Damaged/Missing insulation jacketing",
  "mech": "Insulation jacketing"
 },
 "04VI": {
  "cond": "04",
  "suffix": "VI",
  "sev": "critical",
  "desc": "4-Visible subsea thermal leaks",
  "mech": "Thermal leak"
 },
 "04WI": {
  "cond": "04",
  "suffix": "WI",
  "sev": "critical",
  "desc": "4-Visible water ingress/dripping",
  "mech": "Water ingress"
 },
 "01GD": {
  "cond": "01",
  "suffix": "GD",
  "sev": "low",
  "desc": "A-General Defect, no category",
  "mech": "A-General Defect, no cat"
 },
 "01VS": {
  "cond": "01",
  "suffix": "VS",
  "sev": "low",
  "desc": "B-Valve stuck, closed position, sticking",
  "mech": "Valve stuck"
 },
 "02VS": {
  "cond": "02",
  "suffix": "VS",
  "sev": "medium",
  "desc": "C-Valve stuck, opens too late, fouling",
  "mech": "Valve stuck"
 },
 "03VS": {
  "cond": "03",
  "suffix": "VS",
  "sev": "high",
  "desc": "D-Valve stuck, pollution",
  "mech": "Valve stuck"
 },
 "00NM": {
  "cond": "00",
  "suffix": "NM",
  "sev": "unknown",
  "desc": "0-Test Failed",
  "mech": "0-Test Failed"
 },
 "00UN": {
  "cond": "00",
  "suffix": "UN",
  "sev": "unknown",
  "desc": "Unknown",
  "mech": "Unknown"
 },
 "01TH": {
  "cond": "01",
  "suffix": "TH",
  "sev": "low",
  "desc": "Good condition",
  "mech": "Wall thinning"
 },
 "02TH": {
  "cond": "02",
  "suffix": "TH",
  "sev": "medium",
  "desc": "Thickess Loss (Alarm 1)",
  "mech": "Wall thinning"
 },
 "03TH": {
  "cond": "03",
  "suffix": "TH",
  "sev": "high",
  "desc": "Thickess Loss (Alarm 2)",
  "mech": "Wall thinning"
 },
 "04TH": {
  "cond": "04",
  "suffix": "TH",
  "sev": "critical",
  "desc": "Thickess Loss (Alarm 3)",
  "mech": "Wall thinning"
 },
 "01SU": {
  "cond": "01",
  "suffix": "SU",
  "sev": "low",
  "desc": "Good condition",
  "mech": "Surface defect"
 },
 "02SU": {
  "cond": "02",
  "suffix": "SU",
  "sev": "medium",
  "desc": "Minor anomaly",
  "mech": "Surface defect"
 },
 "03SU": {
  "cond": "03",
  "suffix": "SU",
  "sev": "high",
  "desc": "Significant defect",
  "mech": "Surface defect"
 },
 "04SU": {
  "cond": "04",
  "suffix": "SU",
  "sev": "critical",
  "desc": "Major defect",
  "mech": "Surface defect"
 },
 "01BO": {
  "cond": "01",
  "suffix": "BO",
  "sev": "low",
  "desc": "Fixed",
  "mech": "Fixed"
 },
 "02BO": {
  "cond": "02",
  "suffix": "BO",
  "sev": "medium",
  "desc": "Loose bolting (minor)",
  "mech": "Loose bolting (minor)"
 },
 "03BO": {
  "cond": "03",
  "suffix": "BO",
  "sev": "high",
  "desc": "Loose bolting (significant)",
  "mech": "Loose bolting (significa"
 },
 "04BO": {
  "cond": "04",
  "suffix": "BO",
  "sev": "critical",
  "desc": "Loose bolting (major)",
  "mech": "Loose bolting (major)"
 },
 "02CL": {
  "cond": "02",
  "suffix": "CL",
  "sev": "medium",
  "desc": "Minor anomaly",
  "mech": "Cleanliness"
 },
 "03CL": {
  "cond": "03",
  "suffix": "CL",
  "sev": "high",
  "desc": "Significant damage",
  "mech": "Cleanliness"
 },
 "04CL": {
  "cond": "04",
  "suffix": "CL",
  "sev": "critical",
  "desc": "Major Damage",
  "mech": "Cleanliness"
 },
 "02DA": {
  "cond": "02",
  "suffix": "DA",
  "sev": "medium",
  "desc": "Drawing to update",
  "mech": "Drawing to update"
 },
 "02CK": {
  "cond": "02",
  "suffix": "CK",
  "sev": "medium",
  "desc": "Minor crack",
  "mech": "Minor crack"
 },
 "03CK": {
  "cond": "03",
  "suffix": "CK",
  "sev": "high",
  "desc": "Significant crack",
  "mech": "Significant crack"
 },
 "04CK": {
  "cond": "04",
  "suffix": "CK",
  "sev": "critical",
  "desc": "Major crack",
  "mech": "Major crack"
 },
 "02MD": {
  "cond": "02",
  "suffix": "MD",
  "sev": "medium",
  "desc": "Minor mechanical damage",
  "mech": "Minor mechanical damage"
 },
 "03MD": {
  "cond": "03",
  "suffix": "MD",
  "sev": "high",
  "desc": "Significant mechanical damage",
  "mech": "Significant mechanical d"
 },
 "04MD": {
  "cond": "04",
  "suffix": "MD",
  "sev": "critical",
  "desc": "Major mechanical damage",
  "mech": "Major mechanical damage"
 },
 "01PI": {
  "cond": "01",
  "suffix": "PI",
  "sev": "low",
  "desc": "Fixed",
  "mech": "Fixed"
 },
 "02PI": {
  "cond": "02",
  "suffix": "PI",
  "sev": "medium",
  "desc": "Pitting observed, with moderate growth",
  "mech": "Pitting observed, with m"
 },
 "03PI": {
  "cond": "03",
  "suffix": "PI",
  "sev": "high",
  "desc": "Pitting observed, with significant growth",
  "mech": "Pitting observed, with s"
 },
 "04PI": {
  "cond": "04",
  "suffix": "PI",
  "sev": "critical",
  "desc": "Pitting observed, with major growth",
  "mech": "Pitting observed, with m"
 },
 "02TA": {
  "cond": "02",
  "suffix": "TA",
  "sev": "medium",
  "desc": "0-5% -Flaking on newly applied coating",
  "mech": "0-5% -Flaking on newly a"
 },
 "02TB": {
  "cond": "02",
  "suffix": "TB",
  "sev": "medium",
  "desc": ">0-5% - Very small area of chipped/peeling coating",
  "mech": ">0-5% - Very small area "
 },
 "02TC": {
  "cond": "02",
  "suffix": "TC",
  "sev": "medium",
  "desc": "Coating breakdown 25%, minor anomaly.",
  "mech": "Coating breakdown 25%, m"
 },
 "02TD": {
  "cond": "02",
  "suffix": "TD",
  "sev": "medium",
  "desc": "Widespread localised coating breakdown on structur",
  "mech": "Widespread localised coa"
 },
 "03TA": {
  "cond": "03",
  "suffix": "TA",
  "sev": "high",
  "desc": "General corrosion 50% - Slight build up of corrosi",
  "mech": "General corrosion 50% - "
 },
 "03TB": {
  "cond": "03",
  "suffix": "TB",
  "sev": "high",
  "desc": "General 75% coating breakdown with associated unde",
  "mech": "General 75% coating brea"
 },
 "03TC": {
  "cond": "03",
  "suffix": "TC",
  "sev": "high",
  "desc": ">75-90% - Majority of coating missing and remainde",
  "mech": ">75-90% - Majority of co"
 },
 "03TD": {
  "cond": "03",
  "suffix": "TD",
  "sev": "high",
  "desc": "Isolated localised coating deterioration and corro",
  "mech": "Isolated localised coati"
 },
 "04TA": {
  "cond": "04",
  "suffix": "TA",
  "sev": "critical",
  "desc": "Significant build of corrosion product between ins",
  "mech": "Significant build of cor"
 },
 "04TB": {
  "cond": "04",
  "suffix": "TB",
  "sev": "critical",
  "desc": "Severely degraded coating, flaking away in most ar",
  "mech": "Severely degraded coatin"
 },
 "04TC": {
  "cond": "04",
  "suffix": "TC",
  "sev": "critical",
  "desc": "100% coating breakdown and corrosion. Cannot remai",
  "mech": "100% coating breakdown a"
 },
 "02CD": {
  "cond": "02",
  "suffix": "CD",
  "sev": "medium",
  "desc": "Local coating defect without corrosion",
  "mech": "Local coating damage"
 },
 "04LG": {
  "cond": "04",
  "suffix": "LG",
  "sev": "critical",
  "desc": "Ligth corrosion (Remain life>10 years)",
  "mech": "Ligth corrosion (Remain "
 },
 "05RL": {
  "cond": "05",
  "suffix": "RL",
  "sev": "unknown",
  "desc": "Corrosion (10 Ys>Remaining life>5 Ys)",
  "mech": "Corrosion (10 Ys>Remaini"
 },
 "07FL": {
  "cond": "07",
  "suffix": "FL",
  "sev": "unknown",
  "desc": "Corr. flange face(leak before next SD)",
  "mech": "Corr. flange face(leak b"
 },
 "08CO": {
  "cond": "08",
  "suffix": "CO",
  "sev": "unknown",
  "desc": "Severe coating degradation(actve Corr)",
  "mech": "Coating breakdown"
 },
 "08WT": {
  "cond": "08",
  "suffix": "WT",
  "sev": "unknown",
  "desc": "Severe corrosion (t requd<t<nom. WT)",
  "mech": "Severe corrosion (t requ"
 },
 "10TM": {
  "cond": "10",
  "suffix": "TM",
  "sev": "unknown",
  "desc": "Severe Corr. with t - (CR x Ip)<Tmin",
  "mech": "Severe Corr. with t - (C"
 },
 "11TT": {
  "cond": "11",
  "suffix": "TT",
  "sev": "unknown",
  "desc": "Severe Corr. or erosion with t<T min",
  "mech": "Severe Corr. or erosion "
 },
 "12TL": {
  "cond": "12",
  "suffix": "TL",
  "sev": "unknown",
  "desc": "Through thickness corrosion, leaks",
  "mech": "Through thickness corros"
 }
};
