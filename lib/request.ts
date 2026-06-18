export function parseOptionalIntParam(value: string | null, paramName: string) {
  if (value === null || value.trim() === "") {
    return {
      value: undefined
    };
  }

  if (!/^\d+$/.test(value)) {
    return {
      error: `${paramName} must be a positive integer.`
    };
  }

  return {
    value: Number(value)
  };
}

export function parseIntParam(value: string, paramName: string, min = 1, max?: number) {
  if (!/^\d+$/.test(value)) {
    return {
      error: `${paramName} must be a positive integer.`
    };
  }

  const num = Number(value);

  if (min !== undefined && num < min) {
    return {
      error: `${paramName} must be at least ${min}.`
    };
  }

  if (max !== undefined && num > max) {
    return {
      error: `${paramName} must be at most ${max}.`
    };
  }

  return {
    value: num
  };
}
