// Chrome拡張機能アイコンがクリックされたら、新しいタブでPDF StudioのTOPページ（index.html）を開く
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({
    url: chrome.runtime.getURL('index.html')
  });
});
