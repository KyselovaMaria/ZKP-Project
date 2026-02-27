pragma circom 2.0.0;

/*
 * age_check.circom
 *
 * Доводить що prover знає вік >= 18, не розкриваючи сам вік.
 *
 * Використовує два компоненти з circomlib:
 *   - Num2Bits(n)      : розкладає число у n біт, доводячи що воно < 2^n
 *   - GreaterEqThan(n) : перевіряє a >= b для n-бітних чисел
 *
 * Чому потрібен явний range check через Num2Bits
 * -----------------------------------------------
 * Сигнали в Circom є елементами скінченного поля ℤ_p де p ≈ 2^254 (BN128).
 * Це не звичайні цілі числа, тому від'ємних значень як таких немає.
 *
 * Без range check можлива атака:
 *   age = 0, threshold = 18
 *   delta = 0 - 18 = p - 18 (mod p) — величезне позитивне число у полі
 *   GreaterEqThan побачить p-18 >> 0 і поверне true — хибно!
 *
 * Захист: застосовуємо Num2Bits(7) до delta.
 * Якщо delta від'ємне, то delta mod p ≈ 2^254 — не вміщується у 7 біт,
 * witness не існує, генерація proof падає з помилкою.
 */

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";

template AgeCheck() {

    signal input age;        // private: вік prover'а, не залишає браузер
    signal input threshold;  // public:  мінімальний вік (18)

    // Крок 1: перевіряємо що age належить [0, 127]
    component ageRange = Num2Bits(7);
    ageRange.in <== age;

    // Крок 2: перевіряємо що threshold належить [0, 31]
    component threshRange = Num2Bits(5);
    threshRange.in <== threshold;

    // Крок 3: обчислюємо різницю (залишається приватною)
    signal delta;
    delta <== age - threshold;

    // Крок 4: головний range proof
    // Доводимо що delta належить [0, 127], тобто age - threshold >= 0,
    // що рівнозначно age >= threshold.
    // Якщо age < threshold — Num2Bits(7) не зможе розкласти delta → помилка.
    component deltaRange = Num2Bits(7);
    deltaRange.in <== delta;

    // Крок 5: явна перевірка через компаратор (безпечна після range checks вище)
    component gte = GreaterEqThan(8);
    gte.in[0] <== age;
    gte.in[1] <== threshold;
    gte.out === 1;
}

/*
 * Публічні входи: threshold
 * Верифікатор бачить: threshold, proof (pi_a, pi_b, pi_c)
 * Верифікатор не бачить: age, delta
 * Кількість constraints: ~44
 */
component main { public [threshold] } = AgeCheck();
