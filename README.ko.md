# Polygon ZIP Uploader

[English](README.md) | [한국어](README.ko.md)

[Codeforces Polygon](https://polygon.codeforces.com)에 문제 패키지 ZIP을 업로드하는 Chrome 확장 프로그램입니다.

[Chrome 웹 스토어에서 설치](https://chromewebstore.google.com/detail/polygon-zip-uploader/fhlocfeafcanblbeppffhdilbkblmdcn)

1. [Polygon API 설정](https://polygon.codeforces.com/settings)에서 API Key와 Secret을 발급합니다.
2. 확장 프로그램을 열어 키를 저장합니다.
3. `problem.xml`이 포함된 ZIP을 선택하고 새 문제 또는 기존 문제를 선택합니다.
4. **Polygon에 업로드**를 누릅니다.

팝업을 닫아도 업로드는 계속됩니다. 실패한 작업은 다시 시도할 수 있습니다.

**기존 문제를 갱신할 때:** 먼저 백업하세요. ZIP에 없는 파일·테스트·지문 첨부물이 삭제될 수 있습니다. 기본 `tests` 테스트셋만 지원하며, 새 바이너리 파일과 지문 이미지는 업로드할 수 없습니다. ZIP 크기 제한은 100MB입니다.

[문의 및 버그 제보](https://github.com/rlatjwls7882/polygon-package-importer/issues) · [개인정보 처리방침](PRIVACY.ko.md) · [라이선스](LICENSE)

Codeforces의 공식 확장 프로그램이 아닙니다.
