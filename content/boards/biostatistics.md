---
title: Biostatistics for the boards
emoji: "📊"
group: Biostatistics
order: 1
summary: Sensitivity, specificity, predictive values, likelihood ratios, NNT and the biases that fool screening programs.
tags: [biostatistics, NNT, sensitivity, specificity, likelihood ratio, ABIM]
reviewed: 2026-11-26
sources: Users' Guides to the Medical Literature, 3rd ed.
---

:::bottom
- **NNT = 1 / ARR** (absolute, not relative). NNH = 1 / absolute risk increase.
- **Sensitivity** rules **out** (SnNout); **specificity** rules **in** (SpPin).
- **Predictive values change with prevalence**; sensitivity and specificity do not.
- **LR+ >10** or **LR− <0.1** changes probability a lot.
:::

## 🧮 The 2 × 2 table

| | Disease + | Disease − |
|---|---|---|
| Test + | TP (a) | FP (b) |
| Test − | FN (c) | TN (d) |

| Measure | Formula |
|---|---|
| Sensitivity | a / (a + c) |
| Specificity | d / (b + d) |
| PPV | a / (a + b) |
| NPV | d / (c + d) |
| LR+ | sensitivity / (1 − specificity) |
| LR− | (1 − sensitivity) / specificity |

## 🧮 Risk

| Measure | Formula |
|---|---|
| Absolute risk reduction | Control rate − treatment rate |
| Relative risk | Treatment rate / control rate |
| Relative risk reduction | 1 − RR |
| Odds ratio | (a × d) / (b × c) — used in case-control studies |

## 🎓 Board corner

:::board
- **Lead-time bias**: earlier diagnosis makes survival look longer without changing time of death.
- **Length-time bias**: screening finds slow-growing tumors more often.
- **Overdiagnosis**: finding disease that would never cause harm (prostate, thyroid).
- Use **intention-to-treat** analysis to keep randomization intact.
:::

## 📚 References

- Guyatt G, et al. *Users' Guides to the Medical Literature*. 3rd ed. JAMA/McGraw-Hill; 2015.
