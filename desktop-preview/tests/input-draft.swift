import Foundation

@main struct DraftChecks {
    static func main() throws {
        let original="嗨👩🏽‍💻，明天上午见。尾巴" as NSString
        let range=original.range(of:"明天上午见。")
        var draft=InputDraft(value:original as String,range:range)!
        let first=try draft.replacing(in:original as String,with:"明早见🙂")
        precondition(first=="嗨👩🏽‍💻，明早见🙂尾巴")
        draft.confirm(first,replacement:"明早见🙂")
        let second=try draft.replacing(in:first,with:"明早见")
        precondition(second=="嗨👩🏽‍💻，明早见尾巴")
        draft.confirm(second,replacement:"明早见")
        let restored=try draft.replacing(in:second,with:draft.originalSelection)
        precondition(restored==original as String)
        do {_ = try draft.replacing(in:"用户手改",with:"新版本");fatalError("overwrote manual edit")} catch is InputPasteFailure {}
        precondition(InputDraft(value:"x",range:NSRange(location:2,length:0))==nil)
        let empty=InputDraft(value:"",range:NSRange(location:0,length:0))!
        let insertion=try empty.replacing(in:"",with:"第一版");precondition(insertion=="第一版")
        print("Input draft: selected range, Unicode, revision, original selection, manual conflict and empty insertion passed")
    }
}
