-- Fix urine tests that were miscategorized as blood
UPDATE lab_tests SET category = 'urine' WHERE category = 'blood' AND (
  code ~* '(моч|урин|\mоам\M|осадок|удельн|нитрит|кетон|уробилиноген|кровь.*полукол)' OR
  code ~* '^(цвет|прозрачность|запах|слизь|реакция|ph|эпителий|бактерии|дрожжев|цилиндр|кристалл|соли|сперматозоид)$' OR
  code ~* '^(цвет|прозрачность|эпителий|бактери|цилиндр|кристалл)');
