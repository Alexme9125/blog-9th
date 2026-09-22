export function loginErrorMessage(error: {
  status: number;
  code?: string;
}): string {
  if (error.status === 429) return "尝试过于频繁，请稍候再试。";
  if (error.status >= 500)
    return "登录服务暂时不可用，请稍后重试或联系管理员。";
  if (
    [
      "INVALID_ORIGIN",
      "MISSING_OR_NULL_ORIGIN",
      "CROSS_SITE_NAVIGATION_LOGIN_BLOCKED",
    ].includes(error.code || "")
  ) {
    return "当前访问地址与登录服务配置不一致，请从正确的站点地址重新打开，或联系管理员。";
  }
  return "邮箱或密码不正确，或此账号已停用。请检查后重试。";
}
