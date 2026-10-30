# Wireless UT corrosion monitoring and mapping package

## Purpose

This package provides the reusable Wireless Ultrasonic Testing (UT) framework for the Integrity Copilot demonstrator. It addresses ageing offshore facilities reported by the commissioning brief as operating for more than 20 years and experiencing severe, unexpected leaks on insulated and uninsulated piping. The recommended concept combines baseline thickness mapping with strategically placed fixed Wireless UT monitoring, risk-based prioritization, traceable trending, alerts and engineer-controlled decision support.

**The framework is the product.** The video, audio, extracted frames, proposal and poster are background research that informed the base case. They are not runtime inspection evidence, demo-circuit observations or inputs that an agent may use to infer wall condition. Start with [`framework/README.md`](framework/README.md) when implementing the UT portion of the hackathon.

This is a feasibility and pilot-definition package. It is not installation authorization, a fitness-for-service assessment, proof of remaining wall thickness, or permission to change an inspection interval or operating limit.

## Decision requested

Authorize a site-specific definition phase for an approximately nine-month pilot, subject to site verification and engineering approval. The current planning basis is three to five piping circuits and 24 to 40 monitoring locations, including at least six months of monitored operation. These quantities are engineering assumptions, not facts derived from the source video.

## Package map

| Area | Contents | Use |
| --- | --- | --- |
| [`framework/`](framework/) | Canonical lifecycle, data adapters, machine-readable planning contract | Build and verify the UT part of Integrity Copilot |
| [`deliverables/`](deliverables/) | Draft proposal in DOCX and PDF plus project poster | Management and multidisciplinary review |
| [`evidence/images/`](evidence/images/) | Nine presenter-free, timestamped research frames | Background rationale only; never demo-asset inspection evidence |
| [`manifests/media_manifest.csv`](manifests/media_manifest.csv) | One row for every included image | Image-to-source traceability, dimensions and checksums |
| [`manifests/claims_manifest.csv`](manifests/claims_manifest.csv) | Decision-relevant claims classified by provenance | Separates source facts, commissioning context, assumptions, recommendations and limitations |
| [`PILOT_ROADMAP.md`](PILOT_ROADMAP.md) | Gated implementation plan | Pilot definition, baseline, installation, operation and evaluation |
| [`AGENT_INTEGRATION.md`](AGENT_INTEGRATION.md) | UT agent/module boundary | Integration with the Meta-only Integrity Copilot and future A2A orchestration |
| [`SOURCE_ASSETS.md`](SOURCE_ASSETS.md) | External large-asset paths and checksums | Locates the uncommitted video/audio evidence without copying it into Git |
| [`references/`](references/) | Preserved source evidence notes, trim manifest and validation report | Audit context from the original evidence package |
| [`tools/validate_package.py`](tools/validate_package.py) | Dependency-free package validator | Rechecks links, manifests, checksums, file signatures and image dimensions |

## Business and engineering basis

The source presentation visibly supports the following limited propositions:

- Monitoring provides repeated observations at a fixed location, while inspection campaigns provide periodic observations. The presentation examples motivate testing whether higher-frequency data can expose temporal changes between campaigns.
- The conceptual system has sensors, a gateway and data management. The project adds data-quality controls, OT security, evidence provenance and named engineering review.
- Industrial mounting examples exist, but site-specific mounting, coupling, temperature compensation, hazardous-area suitability, radio coverage and maintainability require verification.
- Trend examples include stable, linear, variable and episodic behavior. They are explanatory examples, not measurements from the proposed offshore circuits.
- A case-study slide visibly distinguishes a baseline robotic scan from later point-sensor placement. This supports the proposed separation between spatial mapping and fixed-point monitoring; the screenshot is not the underlying scan dataset.

The commissioning brief adds the context that refinery facilities described as more than 40 years old were used as precedent. That age statement has not been independently verified as a transcript quotation and must remain commissioning-brief context. The package transfers the use-case logic, not the refinery's claimed outcomes or savings.

## Assurance boundary

- Wireless UT point sensors do not establish the condition between sensors or around the unmeasured circumference.
- Images and model outputs must never supply wall thickness, corrosion rate, minimum required thickness, remaining life or fitness-for-service acceptance.
- A dashboard alert is a review trigger. Suspected change requires raw-data review and verification by an approved inspection method before engineering disposition.
- The technology does not replace statutory inspection, RBI, FFS, leak detection, approved CUI programs or qualified engineering judgment.
- Existing inspection obligations and operating limits remain in force unless changed through a separate approved process.
- Presentation savings, service-life, network-performance and temperature-limit claims are excluded from the business case until independently verified.

## How to use this package

1. Use [`framework/README.md`](framework/README.md) as the shared implementation contract.
2. Use [`framework/ADAPTERS.md`](framework/ADAPTERS.md) for runtime ingestion contracts and [`framework/WORKFLOW.md`](framework/WORKFLOW.md) for lifecycle gates.
3. Read [`manifests/claims_manifest.csv`](manifests/claims_manifest.csv) before reusing a background claim. Preserve its provenance class and approval requirement.
4. Use [`PILOT_ROADMAP.md`](PILOT_ROADMAP.md) to define the gated pilot. Do not bypass the site-verification gates.
5. Use [`AGENT_INTEGRATION.md`](AGENT_INTEGRATION.md) when wiring the framework into the Integrity Copilot. Deterministic measurements and calculations remain outside model reasoning.
6. Run `python3 tools/validate_package.py` from this directory after moving or changing any framework or package file.

## Source and status

The preserved source package is a local source package outside this repository (`$WIRELESS_UT_SOURCE_ROOT`). The original video is external to Git and verified by SHA-256 in `SOURCE_ASSETS.md`. The supplied audio has not been substantively transcribed or reviewed, so this package does not attribute spoken claims. The current proposal and poster remain draft material pending asset-owner, integrity, UT, HSE, OT and image-use review.
