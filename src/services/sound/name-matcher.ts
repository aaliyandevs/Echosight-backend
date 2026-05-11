const normalizeToken = (value: string): string => {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const levenshteinDistance = (a: string, b: string): number => {
  if (a === b) {
    return 0;
  }

  const matrix: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0)
  );

  for (let i = 0; i <= a.length; i += 1) {
    matrix[i][0] = i;
  }
  for (let j = 0; j <= b.length; j += 1) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[a.length][b.length];
};

export const isNameInTranscript = (
  transcript: string,
  userName: string
): boolean => {
  const normalizedTranscript = normalizeToken(transcript);
  const normalizedName = normalizeToken(userName);

  if (!normalizedTranscript || !normalizedName) {
    return false;
  }

  if (normalizedTranscript.includes(normalizedName)) {
    return true;
  }

  const transcriptWords = normalizedTranscript.split(" ");
  const nameWords = normalizedName.split(" ");

  for (const targetWord of nameWords) {
    if (!targetWord) {
      continue;
    }
    for (const sourceWord of transcriptWords) {
      if (!sourceWord) {
        continue;
      }
      const distance = levenshteinDistance(sourceWord, targetWord);
      if (distance <= 1) {
        return true;
      }
    }
  }

  return false;
};

