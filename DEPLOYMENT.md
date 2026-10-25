# ��װ�벿��

����Ŀ���������չ�ͱ��� Node.js ������ɣ���ǰ�汾 1.0.2�������������Ӧ������ͬһ̨���ԣ����� Windows ������ֿ��Դ��ű���Ӧ��

## ����Ҫ��

- Node.js 22 ����߰汾��`node --version` ���á�
- Chrome ����� Manifest V3 �� Chromium �������
- Ĭ�� AI �����Ҫ�Ѱ�װ����¼�� Codex CLI��Ҳ��������չ������ DeepSeek ����ݽӿڡ�
- Python �������ؽ����� ZIP�����Ƿ�������������

��Ŀû�� npm �ⲿ�������������밲װ���ڵ� REA ���߼������С�������ع������Ҫ����� Playwright ������

## �״ΰ�װ

1. ��Դ��򷢲�����ѹ���̶�Ŀ¼������ `extension`��`lib`��`scripts` ������Ŀ¼�ṹ��
2. ���軷�����ã��� `.env.example` ����Ϊ `.env`���������ò�Ҫ���ǡ�Ĭ��ʹ�ñ��� Codex ��¼��
3. ˫�� `start.cmd`��������ĿĿ¼ִ�� `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/manage-service.ps1 -Action Start`�����Ǳ�����̨����������ʽ��
4. Chrome �� `chrome://extensions/`���� Edge �� `edge://extensions/`�����ÿ�����ģʽ��ѡ�񡰼����ѽ�ѹ����չ���򡱣�ѡ����Ŀ�� `extension` Ŀ¼��
5. �ڱ����� `data/token.txt`�����������������չ���������档��Ҫ�������ƻ����ύ�� GitHub��
6. ˢ���Ѵ򿪵Ŀγ�ҳ������չ��ȷ�Ϸ��������ӡ��汾һ�£���ѡ�����γ��½ڿ�ʼʹ�á�

��ϣ�������� Windows ��¼���������У�

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/manage-service.ps1 -Action Install
```

�ű�ʹ������ `Codex-Chaoxing-Local-Agent`���ල�����˳���ָ�����װ���������������û��������С�����Ĭ�ϼ��� `127.0.0.1:18765`����չЭ��ʹ�ù̶��˿ڣ�����Ĭ��ֵ��

## AI ����

��չ���������λ�� `data/provider.json`�������� `.env` Ĭ��ֵ���޸ĺ��ʱӦ�ȵȴ���ǰ���������ֹͣ����

���ݽӿ�����ʾ����ռλֵ��Ҫ�����滻����

```ini
AGENT_PROVIDER=http
AGENT_BASE_URL=https://your-provider.example/v1
AGENT_API_KEY=replace-with-your-key
AGENT_MODEL=replace-with-your-model
AGENT_RESPONSE_FORMAT=json_schema
PORT=18765
```

�����ʽ��ѡ `json_schema`��`json_object` �� `text`��ȡ���ڷ���������DeepSeek Ԥ��Ĭ��ʹ�� `json_object`��Ҳ����ֱ��ͨ����չ���� AI ��ˡ���Ŀ��γ������Ļᷢ�͸���ѡ��ˡ�

�޸� `.env` ���������񡣱������д����� `NO_PROXY` ���ã�ʹ�� hzvpn �ȶ��Žӵı�������ʹ�� `127.0.0.1:17891`����Ҫ������ڵ�仯�����ζ˿ڡ�������������Ӧ�ƹ���������ͨ��װ��Ҫ�����ø��Žӡ�

## ״̬������������Ų�

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/manage-service.ps1 -Action Status
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/manage-service.ps1 -Action Restart
```

- �޷����ӣ��ȼ��״̬�����������񣻲鿴 `data/service-stderr.log` �� `data/service-lifecycle.log`��
- ���ʧ�ܣ����¸��Ƶ�ǰ `data/token.txt`����Ҫͨ��ɾ������ data Ŀ¼������⡣
- ģ�ʹ���Ĭ�Ϻ���������ն����� `codex login status` ����¼���ӿں�˼����ѡģ�͡���ַ����ȡ�
- ����δ��Ч�������չ�Ƿ����б������ã��Ƿ񸲸� `.env`�����´�������¼�����չ��ˢ�¿γ�ҳ��
- �˿�ռ�ã�ȷ��ռ���ߣ������ű�����ֹͣ�����ڱ���Ŀ�ĳ���
- �ύ���δ֪���ȼ��ƽ̨��ִ������ȷ��û���ύʱʹ����չ�ṩ�ĵ�ǰҳδȷ�ϼ�¼�������ܣ������ظ��ύ��

Edge ���£��� `edge://extensions/`���ҵ������߲���������¼��ء������ˢ�¿γ�ҳ�棬ȷ����չ�뱾�ط���汾��Ϊ 1.0.2��Chrome ʹ�� `chrome://extensions/` ���ͬ��������

����ǰֹͣ�йܲ����ݱ��� `.env` �� `data`�����³����ļ��������������¼�����չ��ˢ��ҳ�档����ͬ�������������ݣ����ݰ���˽�����ݣ�Ӧ�����ڱ�����

## ��֤�뷢��

```powershell
node --test test/*.test.mjs
python scripts/package-release.py
```

2026-10-25 ʹ�� Node.js 24.20.0��**61 �Ԫ����ͨ��**������������е� 10 ��ý�峡��ͨ����δ���ø���ģ�ͻ�����ʵ�γ��ύ��������оߵĻ���������� README����ʷ�����������ʵƽ̨��ɡ�

���������һ��Ŀ¼�еİ汾 ZIP ����Ŀ�ڵ� `release-files.json`��У��ÿ���ļ� SHA-256���鵵�����Ժ͵�ǰ��������ų�������ֻʹ�ð������鵵���ݣ����ϴ���������Ŀ¼��`.env`��`data/`����ʵ�γ̽�ͼ�� `live-*` ������¼������鵵����������Դ˵���� `extension/vendor/THIRD_PARTY_LICENSES.md`��
