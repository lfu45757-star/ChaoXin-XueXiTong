(() => {
  // Display text only. Raw provider diagnostics may contain the request prompt.
  globalThis.ChaoxingStatusText = value => {
    const text = String(value ?? '');
    const exit = text.match(/Codex\s*退出码\s*(-?\d+)/i);
    if (exit) return /讨论/.test(text.slice(0, exit.index))
      ? `讨论解答失败，已跳过（Codex 退出码 ${exit[1]}）`
      : `AI 解答失败（Codex 退出码 ${exit[1]}），详细内容已隐藏`;
    if (/^\s*讨论处理失败/.test(text)) return '讨论处理失败，已跳过';
    const promptKeys = new Set([...text.matchAll(/["'](context|questions|values)["']\s*:/g)].map(match => match[1]));
    const promptRule = /必须使用给出的\s*key|填空\s*\/\s*简答按输入框顺序给\s*values|保持原\s*id|不确定时降低\s*confidence|不要凭空编造图像内容|请围绕以下教师布置的课程讨论题，生成可直接发表/.test(text);
    if (promptKeys.size >= 2 || promptRule) return 'AI 解答失败，详细内容已隐藏';
    const characters = Array.from(text);
    return characters.length > 160 ? characters.slice(0, 160).join('') + '…' : text;
  };
})();
