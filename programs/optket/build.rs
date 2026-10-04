fn main() {
    println!("cargo:rerun-if-env-changed=AIRBAG_MAINNET_PROGRAM_ID");
    let id = if std::env::var_os("CARGO_FEATURE_MAINNET_BETA").is_some() {
        let id = std::env::var("AIRBAG_MAINNET_PROGRAM_ID")
            .expect("Mainnet beta requires a dedicated AIRBAG_MAINNET_PROGRAM_ID");
        assert!(id != "Ad2TFKtNNzzxcApDZVHdMTVoucSUczNAstfV4ywL1wky", "Never reuse the Devnet program ID");
        assert!((32..=44).contains(&id.len()) && id.bytes().all(|b| b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz".contains(&b)), "Invalid program ID");
        id
    } else { "Ad2TFKtNNzzxcApDZVHdMTVoucSUczNAstfV4ywL1wky".to_owned() };
    println!("cargo:rerun-if-env-changed=AIRBAG_MAINNET_ADMIN");
    let admin = if std::env::var_os("CARGO_FEATURE_MAINNET_BETA").is_some() {
        let a = std::env::var("AIRBAG_MAINNET_ADMIN").expect("Pin AIRBAG_MAINNET_ADMIN before building");
        assert!((32..=44).contains(&a.len()) && a.bytes().all(|b| b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz".contains(&b)), "Invalid admin key");
        a
    } else { "11111111111111111111111111111111".to_owned() };
    std::fs::write(std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("program_id.rs"),
        format!("anchor_lang::declare_id!(\"{}\"); pub const BETA_BOOTSTRAP_ADMIN: anchor_lang::prelude::Pubkey = anchor_lang::prelude::pubkey!(\"{}\");", id, admin)).unwrap();
}
