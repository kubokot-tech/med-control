/**
 * Texts of the demo patient, one set per interface language. Every name, value, place and document is invented.
 * The sets have the same shape: gateway/test/demoTexts.test.js checks it.
 */
export const DEMO = {
  ru: {
    model: 'демо-пример (модель не вызывалась)',
    contextNote: 'Демо-данные: текст написан заранее, модель не вызывалась.',
    anamnesisNote: 'демо',
    patient: { name: 'Анна, демо-пациентка', callName: 'Анна', diagnosis: 'Эндометриоз, железодефицитная анемия' },
    labs: [['Гемоглобин', 'г/л'], ['Эритроциты', '×10¹²/л'], ['Средний объём эритроцита (MCV)', 'фл'], ['Лейкоциты', '×10⁹/л'], ['Тромбоциты', '×10⁹/л'],
      ['Ферритин', 'мкг/л'], ['Сывороточное железо', 'мкмоль/л'], ['Аланинаминотрансфераза (АЛТ)', 'Ед/л'], ['Аспартатаминотрансфераза (АСТ)', 'Ед/л'],
      ['Глюкоза', 'ммоль/л'], ['Холестерин общий', 'ммоль/л'], ['Тиреотропный гормон (ТТГ)', 'мМЕ/л'], ['С-реактивный белок (СРБ)', 'мг/л']],
    labNames: ['Демо-лаборатория', 'Лаборатория «Пример»'],
    pdf: {
      title: (date) => `Анализы ${date} (демо)`,
      disclaimer: 'Демонстрационный бланк: вымышленные данные для МедКонтроля, не медицинский документ.',
      patient: (date) => `Пациент: Демо Пациентка, 34 года        Дата взятия: ${date.split('-').reverse().join('.')}`,
      headers: ['Исследование', 'Результат', 'Ед.', 'Референс'],
      number: (v) => String(v).replace('.', ','),
    },
    labFile: (date) => `demo-analizy-${date}.pdf`,
    milestones: [
      ['Первое обращение: болезненные менструации', 'Боли усилились за последний год, обезболивающие помогают хуже. Направлена на УЗИ.'],
      ['УЗИ малого таза: эндометриоидная киста левого яичника 31 мм', 'Рекомендованы наблюдение и контроль через 6 месяцев.'],
      ['МРТ малого таза: кисты выросли, появилась киста справа', 'Левая 38 мм, правая 15 мм. Обсуждение гормональной терапии.'],
      ['Анализ крови: железодефицитная анемия', 'Гемоглобин 98 г/л, ферритин 6 мкг/л. Назначены таблетки железа.'],
      ['Гинеколог: назначен диеногест 2 мг', 'Приём ежедневно без перерывов. Контрольное УЗИ через 3 месяца, анализ крови раз в месяц, пока гемоглобин не вернётся в норму.'],
    ],
    ironMilestone: ['Терапевт: таблетки железа не помогают, назначено железо внутривенно', 'За два месяца ферритин почти не вырос, от таблеток тошнота. Две капельницы с интервалом в неделю.'],
    goodMilestone: ['Гемоглобин и ферритин в норме', 'Анемия компенсирована, препараты железа больше не нужны. Контроль ферритина через 3 месяца.'],
    mg: 'мг', iu: 'МЕ',
    dienogest: { name: 'Диеногест', instructions: 'Ежедневно вечером, в одно и то же время, без перерывов' },
    iron: { name: 'Железа сульфат', instructions: 'Утром, запивать водой; не сочетать с чаем и кофе', reason: 'Ферритин не растёт: по совету врача две таблетки в день' },
    vitaminD: { name: 'Витамин D', instructions: 'После еды' },
    impressions: [
      'Эндометриоидные кисты обоих яичников: левая 42 мм, правая 19 мм. Исходное исследование перед началом гормональной терапии.',
      'Кисты уменьшились: левая 37 мм (была 42), правая 17 мм. Новых образований нет.',
      'Дальнейшее уменьшение: левая 33 мм, правая 15 мм. Новых образований нет.',
      'Левая киста 30 мм, правая 14 мм, без новых образований. Положительная динамика сохраняется.',
    ],
    lesions: [['Эндометриоидная киста левого яичника', 'левый яичник'], ['Эндометриоидная киста правого яичника', 'правый яичник']],
    studyRegion: 'Органы малого таза',
    course: { title: 'Железо внутривенно', place: 'Процедурный кабинет', reaction: 'Перенесла хорошо' },
    diary: {
      1: 'Первый день диеногеста. Самочувствие обычное.',
      24: 'Мажущие выделения третий день. Врач предупреждала, что в первые месяцы так бывает.',
      52: 'От таблеток железа подташнивает, принимаю после еды.',
      71: 'Первая капельница железа, перенесла хорошо.',
      140: 'Месяц без обезболивающих.',
    },
    gynecologist: 'Гинеколог', therapist: 'Терапевт',
    visitPlace: 'Клиника (демо), каб. 12',
    contacts: [
      { name: 'Гинеколог', role: 'лечащий врач', clinic: 'Клиника (демо)', phones: ['+7 000 000-00-01'], address: 'каб. 12, приём по вторникам и четвергам', notes: 'Вопросы между приёмами — через регистратуру.', pinned: true },
      { name: 'Регистратура клиники', role: 'запись на приём', clinic: 'Клиника (демо)', phones: ['+7 000 000-00-02', '+7 000 000-00-03 доб. 5'], notes: 'Звонить с 8:00 до 16:00.' },
      { name: 'Процедурный кабинет', role: 'капельницы и уколы', clinic: 'Клиника (демо)', phones: ['+7 000 000-00-04'] },
    ],
    nextVisitNotes: 'Взять заключения УЗИ и анализы за последние три месяца.',
    anamnesis: `ПАЦИЕНТ: женщина, 34 года (вымышленный демо-пациент МедКонтроля).
ОСНОВНОЙ ДИАГНОЗ: эндометриоз, эндометриоидные кисты обоих яичников.
СОПУТСТВУЮЩЕЕ: железодефицитная анемия на фоне обильных менструаций, компенсирована после курса внутривенного железа.
ЛЕЧЕНИЕ: два года наблюдение и обезболивающие; когда кисты выросли, назначена гормональная терапия.
ТЕКУЩАЯ ТЕРАПИЯ: диеногест 2 мг ежедневно без перерывов. Витамин D 2000 МЕ.
ЦЕЛИ: контроль боли, уменьшение кист по УЗИ, гемоглобин и ферритин в норме.`,
    visitQuestions: `Коротко о периоде
С прошлого визита диеногест 2 мг принимается ежедневно, пропущен один день. Боль редкая и слабая, обезболивающие не нужны четвёртый месяц. Гемоглобин 131 г/л, ферритин 76 мкг/л: после курса железа держатся в норме. На последнем УЗИ киста слева 30 мм (была 42), справа 14 мм (была 19).

Сказать врачу
• Мажущие выделения прекратились после третьего месяца приёма.
• Вес прибавился примерно на килограмм за восемь месяцев.

Спросить
• Как долго продолжать диеногест, если кисты уменьшаются?
• Когда следующее УЗИ: через три месяца или через полгода?
• Нужно ли проверять плотность костей при длительном приёме?

Показать или принести
• Заключения УЗИ и анализы крови за последние три месяца.

Список подготовлен ИИ по данным МедКонтроля, не медицинская консультация. (Демо: текст написан заранее.)`,
    monthReview: `Итог месяца (демо-пример)
Показатели в норме. Гемоглобин 129 г/л и ферритин 84 мкг/л держатся после курса внутривенного железа, железо сыворотки 15,6 мкмоль/л. АЛТ 23 Ед/л: небольшой подъём в первые месяцы приёма диеногеста прошёл. Холестерин 5,0 ммоль/л, в пределах нормы.

Требует внимания
• Ферритин постепенно снижается: с 138 до 84 мкг/л за четыре месяца. После курса железа это ожидаемо, но за динамикой стоит следить.

Обсудить с врачом
• Когда повторить ферритин и при каком значении возвращаться к препаратам железа.

Это демонстрационный текст: модель не вызывалась.`,
    imagingComment: `Киста левого яичника 30 мм против 42 мм на исходном УЗИ, правого 14 мм против 19 мм: обе уменьшаются от исследования к исследованию. Новых образований не описано. Разница с предыдущим исследованием (3 мм и 1 мм) близка к погрешности измерения на УЗИ, поэтому важнее общая динамика за восемь месяцев.

Это демонстрационный текст: модель не вызывалась.`,
    notes: [
      { day: 24, title: 'Диеногест: чего ждать в первые месяцы', tags: ['диеногест', 'побочки'], body: '# Диеногест: чего ждать в первые месяцы\n\n- Мажущие выделения в первые три месяца бывают часто и обычно проходят.\n- Головная боль и перепады настроения: записывать в дневник, сказать врачу на приёме.\n- Обильное кровотечение или сильная боль: звонить врачу, не ждать приёма.\n\n*Демо-заметка.*' },
      { day: 68, title: 'Железо: что мешает усвоению', tags: ['железо', 'анемия'], body: '# Железо: что мешает усвоению\n\n- Чай, кофе и молочные продукты рядом с таблеткой снижают усвоение.\n- Ферритин после капельниц проверять не раньше чем через месяц.\n- Спросить врача, нужен ли поддерживающий приём.\n\n*Демо-заметка.*' },
      { day: 165, title: 'Вопросы гинекологу', tags: ['эндометриоз', 'вопросы'], body: '# Вопросы гинекологу\n\n1. Как долго можно принимать диеногест?\n2. Как часто делать УЗИ, когда кисты уменьшаются?\n\n*Демо-заметка.*' },
    ],
  },
  en: {
    model: 'demo example (no model was called)',
    contextNote: 'Demo data: this text was written in advance, no model was called.',
    anamnesisNote: 'demo',
    patient: { name: 'Anna, demo patient', callName: 'Anna', diagnosis: 'Endometriosis, iron-deficiency anemia' },
    labs: [['Hemoglobin', 'g/L'], ['Red blood cells', '×10¹²/L'], ['Mean corpuscular volume (MCV)', 'fL'], ['White blood cells', '×10⁹/L'], ['Platelets', '×10⁹/L'],
      ['Ferritin', 'ng/mL'], ['Serum iron', 'µmol/L'], ['Alanine aminotransferase (ALT)', 'U/L'], ['Aspartate aminotransferase (AST)', 'U/L'],
      ['Glucose', 'mmol/L'], ['Total cholesterol', 'mmol/L'], ['Thyroid-stimulating hormone (TSH)', 'mIU/L'], ['C-reactive protein (CRP)', 'mg/L']],
    labNames: ['Demo Laboratory', 'Sample Lab'],
    pdf: {
      title: (date) => `Lab results ${date} (demo)`,
      disclaimer: 'Demonstration report: invented data for MedControl, not a medical document.',
      patient: (date) => `Patient: Demo Patient, 34 y        Collected: ${date}`,
      headers: ['Test', 'Result', 'Unit', 'Reference'],
      number: (v) => String(v),
    },
    labFile: (date) => `demo-labs-${date}.pdf`,
    milestones: [
      ['First visit: painful periods', 'The pain got worse over the past year and painkillers help less. Referred for an ultrasound.'],
      ['Pelvic ultrasound: endometrioma of the left ovary, 31 mm', 'Watchful waiting, follow-up in 6 months.'],
      ['Pelvic MRI: the cysts have grown, a new one on the right', 'Left 38 mm, right 15 mm. Hormonal therapy under discussion.'],
      ['Blood test: iron-deficiency anemia', 'Hemoglobin 98 g/L, ferritin 6 ng/mL. Iron tablets prescribed.'],
      ['Gynecologist: dienogest 2 mg prescribed', 'Every day without breaks. Follow-up ultrasound in 3 months, blood tests monthly until hemoglobin is back in range.'],
    ],
    ironMilestone: ['Primary care: iron tablets are not working, IV iron prescribed', 'Ferritin barely rose in two months, and the tablets cause nausea. Two infusions a week apart.'],
    goodMilestone: ['Hemoglobin and ferritin back in range', 'The anemia has resolved, iron is no longer needed. Recheck ferritin in 3 months.'],
    mg: 'mg', iu: 'IU',
    dienogest: { name: 'Dienogest', instructions: 'Every evening at the same time, without breaks' },
    iron: { name: 'Ferrous sulfate', instructions: 'In the morning with water; not with tea or coffee', reason: 'Ferritin is not rising: two tablets a day on the doctor\'s advice' },
    vitaminD: { name: 'Vitamin D', instructions: 'After food' },
    impressions: [
      'Endometriomas of both ovaries: left 42 mm, right 19 mm. Baseline study before hormonal therapy.',
      'The cysts are smaller: left 37 mm (was 42), right 17 mm. No new lesions.',
      'Smaller again: left 33 mm, right 15 mm. No new lesions.',
      'Left cyst 30 mm, right 14 mm, no new lesions. The improvement continues.',
    ],
    lesions: [['Left ovarian endometrioma', 'left ovary'], ['Right ovarian endometrioma', 'right ovary']],
    studyRegion: 'Pelvis',
    course: { title: 'IV iron', place: 'Infusion room', reaction: 'Tolerated well' },
    diary: {
      1: 'First day of dienogest. Feeling as usual.',
      24: 'Spotting for the third day. The doctor said this can happen in the first months.',
      52: 'The iron tablets make me nauseous, taking them after food.',
      71: 'First iron infusion, tolerated it well.',
      140: 'A month without painkillers.',
    },
    gynecologist: 'Gynecologist', therapist: 'Primary care doctor',
    visitPlace: 'Clinic (demo), Room 12',
    contacts: [
      { name: 'Gynecologist', role: 'treating doctor', clinic: 'Clinic (demo)', phones: ['+1 202 555 0101'], address: 'Room 12, clinic on Tuesdays and Thursdays', notes: 'Questions between visits go through the front desk.', pinned: true },
      { name: 'Clinic front desk', role: 'appointments', clinic: 'Clinic (demo)', phones: ['+1 202 555 0102', '+1 202 555 0103 ext. 5'], notes: 'Call between 8 AM and 4 PM.' },
      { name: 'Infusion room', role: 'infusions and injections', clinic: 'Clinic (demo)', phones: ['+1 202 555 0104'] },
    ],
    nextVisitNotes: 'Bring the ultrasound reports and the lab results for the last three months.',
    anamnesis: `PATIENT: woman, 34 (fictional MedControl demo patient).
MAIN DIAGNOSIS: endometriosis, endometriomas of both ovaries.
OTHER CONDITIONS: iron-deficiency anemia from heavy periods, resolved after a course of IV iron.
TREATMENT: two years of watchful waiting and painkillers; hormonal therapy started when the cysts grew.
CURRENT THERAPY: dienogest 2 mg every day without breaks. Vitamin D 2000 IU.
GOALS: pain control, smaller cysts on ultrasound, hemoglobin and ferritin in range.`,
    visitQuestions: `Period summary
Since the last visit dienogest 2 mg has been taken every day, one day was skipped. Pain is rare and mild, no painkillers for more than three months. Hemoglobin 131 g/L, ferritin 76 ng/mL: both have stayed in range since the iron course. On the latest ultrasound the left cyst is 30 mm (was 42), the right 14 mm (was 19).

Tell the doctor
• The spotting stopped after the third month of treatment.
• Weight is up by about a kilogram over eight months.

Ask
• How long should dienogest continue if the cysts keep shrinking?
• When is the next ultrasound: in three months or in six?
• Does bone density need checking on long-term treatment?

Show or bring
• The ultrasound reports and blood tests for the last three months.

List prepared by AI from MedControl data, not medical advice. (Demo: this text was written in advance.)`,
    monthReview: `Month in review (demo example)
Results are in range. Hemoglobin 129 g/L and ferritin 84 ng/mL have held since the course of IV iron, serum iron is 15.6 µmol/L. ALT 23 U/L: the small rise in the first months on dienogest has passed. Cholesterol 5.0 mmol/L, in range.

Needs attention
• Ferritin is slowly coming down: from 138 to 84 ng/mL over four months. That is expected after an iron course, but the trend is worth watching.

Discuss with the doctor
• When to repeat ferritin, and at what value to go back to iron.

This is demonstration text: no model was called.`,
    imagingComment: `Left ovarian cyst 30 mm against 42 mm on the baseline ultrasound, right 14 mm against 19 mm: both get smaller from study to study. No new lesions are described. The difference from the previous study (3 mm and 1 mm) is close to the measurement error of ultrasound, so the trend over eight months matters more.

This is demonstration text: no model was called.`,
    notes: [
      { day: 24, title: 'Dienogest: what to expect in the first months', tags: ['dienogest', 'side-effects'], body: '# Dienogest: what to expect in the first months\n\n- Spotting is common in the first three months and usually passes.\n- Headache and mood swings: write them in the diary, tell the doctor at the visit.\n- Heavy bleeding or severe pain: call the doctor, do not wait for the visit.\n\n*Demo note.*' },
      { day: 68, title: 'Iron: what gets in the way', tags: ['iron', 'anemia'], body: '# Iron: what gets in the way\n\n- Tea, coffee and dairy near the tablet reduce absorption.\n- Recheck ferritin no sooner than a month after the infusions.\n- Ask the doctor whether maintenance iron is needed.\n\n*Demo note.*' },
      { day: 165, title: 'Questions for the gynecologist', tags: ['endometriosis', 'questions'], body: '# Questions for the gynecologist\n\n1. How long can dienogest be taken?\n2. How often is an ultrasound needed while the cysts shrink?\n\n*Demo note.*' },
    ],
  },
};
