#!/usr/bin/env python3
"""Generate a strong, random word passphrase for the bet-slip encryption (WC_BETS_PASS).

Uses the OS CSPRNG (`secrets`) and the system dictionary. Random words only —
NOT human-chosen — so the entropy is real. 5 words ≈ 79 bits, uncrackable offline
even though the ciphertext is public.

    python3 scripts/genpass.py        # 5 words (default)
    python3 scripts/genpass.py 6      # 6 words, more margin
"""
import secrets
import math
import sys

WORDS_FILE = "/usr/share/dict/words"


def load_pool() -> list[str]:
    with open(WORDS_FILE, encoding="utf-8") as f:
        words = {w.strip().lower() for w in f}
    # typeable: 4-7 letters, alphabetic only, de-duplicated
    return sorted(w for w in words if 4 <= len(w) <= 7 and w.isalpha())


def main() -> None:
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 5
    if n < 4:
        print("use at least 4 words", file=sys.stderr)
        sys.exit(1)
    pool = load_pool()
    phrase = "-".join(secrets.choice(pool) for _ in range(n))
    bits = n * math.log2(len(pool))
    print(phrase)
    print(f"\n  {n} words from a {len(pool):,}-word pool · ~{bits:.0f} bits of entropy",
          file=sys.stderr)
    print("  store it in a password manager — there is no recovery if lost", file=sys.stderr)


if __name__ == "__main__":
    main()
