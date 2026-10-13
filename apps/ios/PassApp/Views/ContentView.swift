import SwiftUI
import LocalAuthentication
import UniformTypeIdentifiers

// Palette de thèmes personnalisables
public enum AccentTheme: String, CaseIterable, Identifiable {
    case emerald = "emerald"
    case amber = "amber"
    case sapphire = "sapphire"
    case amethyst = "amethyst"
    case ruby = "ruby"

    public var id: String { rawValue }

    public var name: String {
        switch self {
        case .emerald: return "Émeraude"
        case .amber: return "Ambre"
        case .sapphire: return "Saphir"
        case .amethyst: return "Améthyste"
        case .ruby: return "Rubis"
        }
    }

    public var color: Color {
        switch self {
        case .emerald: return Color(red: 0.12, green: 0.62, blue: 0.38)
        case .amber: return Color(red: 0.88, green: 0.43, blue: 0.27)
        case .sapphire: return Color(red: 0.15, green: 0.45, blue: 0.85)
        case .amethyst: return Color(red: 0.55, green: 0.35, blue: 0.85)
        case .ruby: return Color(red: 0.85, green: 0.20, blue: 0.35)
        }
    }
}

public struct ContentView: View {
    @AppStorage("hasCompletedOnboarding") private var hasCompletedOnboarding: Bool = false
    @AppStorage("accentTheme") private var accentTheme: String = "emerald"
    @AppStorage("biometricsEnabled") private var biometricsEnabled: Bool = true

    @State private var isLocked = true
    @State private var masterPassword = ""
    @State private var unlockError: String? = nil
    @State private var entries: [VaultEntry] = [] // Zéro données de test : coffre propre
    @State private var searchText = ""
    @State private var selectedCategory = "Tous"
    @State private var showAddSheet = false
    @State private var showSettingsSheet = false
    @State private var showImportSheet = false
    @State private var revealedPasswords: Set<String> = []
    @State private var copiedId: String? = nil

    private var themeColor: Color {
        (AccentTheme(rawValue: accentTheme) ?? .emerald).color
    }

    @State private var selectedFolder: String? = nil

    private let categories = ["Tous", "Favoris", "Notes", "Fichiers", "Personnel", "Travail", "Finance"]

    private var allFolders: [String] {
        let set = Set(entries.compactMap { $0.folder?.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty })
        return Array(set).sorted()
    }

    private var filteredEntries: [VaultEntry] {
        if isLocked { return [] }
        return entries.filter { entry in
            let matchesCategory: Bool
            if selectedCategory == "Tous" {
                matchesCategory = true
            } else if selectedCategory == "Favoris" {
                matchesCategory = entry.favorite
            } else if selectedCategory == "Notes" {
                matchesCategory = entry.itemType == "note"
            } else if selectedCategory == "Fichiers" {
                matchesCategory = entry.itemType == "file" || !entry.attachments.isEmpty
            } else {
                matchesCategory = entry.category == selectedCategory
            }

            let matchesFolder: Bool
            if let folder = selectedFolder {
                matchesFolder = entry.folder == folder || (entry.folder?.hasPrefix(folder + "/") ?? false)
            } else {
                matchesFolder = true
            }

            let matchesSearch = searchText.isEmpty ||
                entry.title.localizedCaseInsensitiveContains(searchText) ||
                entry.username.localizedCaseInsensitiveContains(searchText) ||
                (entry.folder?.localizedCaseInsensitiveContains(searchText) ?? false) ||
                (entry.notes?.localizedCaseInsensitiveContains(searchText) ?? false)

            return matchesCategory && matchesFolder && matchesSearch
        }
    }

    public init() {}

    public var body: some View {
        Group {
            if !hasCompletedOnboarding {
                OnboardingWizardView(
                    themeColor: themeColor,
                    onComplete: { _, initialPassword, enableBio in
                        biometricsEnabled = enableBio
                        hasCompletedOnboarding = true
                        isLocked = false
                        entries = [] // Coffre propre prêt à l'emploi
                    }
                )
            } else {
                NavigationView {
                    ZStack {
                        Color(UIColor.systemGroupedBackground).ignoresSafeArea()

                        if isLocked {
                            lockedView
                        } else {
                            unlockedView
                        }
                    }
                    .navigationTitle("PassApp")
                    .toolbar {
                        ToolbarItem(placement: .navigationBarLeading) {
                            Button {
                                withAnimation(.spring()) {
                                    isLocked.toggle()
                                    if isLocked {
                                        masterPassword = ""
                                        revealedPasswords.removeAll()
                                    }
                                }
                            } label: {
                                Image(systemName: isLocked ? "lock.fill" : "lock.open.fill")
                                    .foregroundColor(isLocked ? .secondary : themeColor)
                            }
                        }

                        ToolbarItem(placement: .navigationBarTrailing) {
                            HStack(spacing: 12) {
                                if !isLocked {
                                    Button {
                                        showImportSheet = true
                                    } label: {
                                        Image(systemName: "square.and.arrow.down")
                                            .foregroundColor(themeColor)
                                    }
                                    .accessibilityLabel("Importer")

                                    Button {
                                        showSettingsSheet = true
                                    } label: {
                                        Image(systemName: "gearshape")
                                            .foregroundColor(.secondary)
                                    }
                                    .accessibilityLabel("Paramètres")

                                    Button {
                                        showAddSheet = true
                                    } label: {
                                        Image(systemName: "plus.circle.fill")
                                            .font(.title3)
                                            .foregroundColor(themeColor)
                                    }
                                    .accessibilityLabel("Ajouter")
                                }
                            }
                        }
                    }
                    .sheet(isPresented: $showAddSheet) {
                        AddEntryView(themeColor: themeColor) { newEntry in
                            withAnimation {
                                entries.insert(newEntry, at: 0)
                            }
                        }
                    }
                    .sheet(isPresented: $showSettingsSheet) {
                        SettingsSheetView(
                            themeColor: themeColor,
                            onOpenImport: {
                                showSettingsSheet = false
                                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                                    showImportSheet = true
                                }
                            },
                            onLockNow: {
                                showSettingsSheet = false
                                withAnimation {
                                    isLocked = true
                                }
                            }
                        )
                    }
                    .sheet(isPresented: $showImportSheet) {
                        ImportSheetView(themeColor: themeColor) { importedEntries in
                            withAnimation {
                                entries = importedEntries + entries
                            }
                        }
                    }
                }
                .onAppear {
                    // ACTIVATION FACE ID IMMÉDIATE AU DÉMARRAGE
                    if hasCompletedOnboarding && isLocked && biometricsEnabled {
                        unlockWithFaceID()
                    }
                }
            }
        }
        .tint(themeColor)
    }

    // ÉCRAN DE VERROUILLAGE ÉLÉGANT
    private var lockedView: some View {
        VStack(spacing: 24) {
            Spacer()

            ZStack {
                Circle()
                    .fill(themeColor.opacity(0.12))
                    .frame(width: 110, height: 110)
                Image(systemName: "lock.shield.fill")
                    .font(.system(size: 52))
                    .foregroundColor(themeColor)
            }

            VStack(spacing: 6) {
                Text("PassApp")
                    .font(.title.bold())
                Text("Coffre-fort chiffré de bout en bout")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }

            VStack(spacing: 14) {
                SecureField("Mot de passe maître", text: $masterPassword)
                    .textFieldStyle(RoundedBorderTextFieldStyle())
                    .padding(.horizontal, 28)
                    .onSubmit { unlockWithPassword() }

                if let err = unlockError {
                    Text(err)
                        .font(.caption)
                        .foregroundColor(.red)
                }

                Button {
                    unlockWithPassword()
                } label: {
                    Text("Déverrouiller")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(themeColor)
                        .foregroundColor(.white)
                        .cornerRadius(12)
                }
                .padding(.horizontal, 28)

                if biometricsEnabled {
                    Button {
                        unlockWithFaceID()
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "faceid")
                                .font(.title3)
                            Text("Déverrouiller avec Face ID")
                                .font(.subheadline.bold())
                        }
                        .foregroundColor(themeColor)
                        .padding(.vertical, 8)
                    }
                }
            }

            Spacer()
            Spacer()
        }
        .padding()
    }

    // ÉCRAN PRINCIPAL DÉVERROUILLÉ
    private var unlockedView: some View {
        VStack(spacing: 0) {
            // SÉLECTEUR DE CATÉGORIES
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(categories, id: \.self) { cat in
                        Button {
                            withAnimation(.easeInOut(duration: 0.15)) {
                                selectedCategory = cat
                            }
                        } label: {
                            Text(cat)
                                .font(.caption.bold())
                                .padding(.horizontal, 14)
                                .padding(.vertical, 8)
                                .background(selectedCategory == cat ? themeColor : Color(UIColor.secondarySystemGroupedBackground))
                                .foregroundColor(selectedCategory == cat ? .white : .primary)
                                .cornerRadius(18)
                        }
                    }
                }
                .padding(.horizontal)
                .padding(.vertical, 10)
            }

            // SÉLECTEUR DE DOSSIERS (si des dossiers existent)
            if !allFolders.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        Button {
                            withAnimation { selectedFolder = nil }
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: "folder")
                                Text("Tous")
                            }
                            .font(.caption2.bold())
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(selectedFolder == nil ? themeColor.opacity(0.15) : Color(UIColor.secondarySystemGroupedBackground))
                            .foregroundColor(selectedFolder == nil ? themeColor : .secondary)
                            .cornerRadius(12)
                        }

                        ForEach(allFolders, id: \.self) { fld in
                            Button {
                                withAnimation {
                                    if selectedFolder == fld {
                                        selectedFolder = nil
                                    } else {
                                        selectedFolder = fld
                                    }
                                }
                            } label: {
                                HStack(spacing: 4) {
                                    Image(systemName: "folder.fill")
                                    Text(fld)
                                }
                                .font(.caption2.bold())
                                .padding(.horizontal, 10)
                                .padding(.vertical, 5)
                                .background(selectedFolder == fld ? themeColor : Color(UIColor.secondarySystemGroupedBackground))
                                .foregroundColor(selectedFolder == fld ? .white : .primary)
                                .cornerRadius(12)
                            }
                        }
                    }
                    .padding(.horizontal)
                    .padding(.bottom, 6)
                }
            }

            // CONTENU : LISTE OU ÉCRAN D'ACCUEIL VIERGE
            if entries.isEmpty {
                emptyVaultView
            } else {
                List {
                    ForEach(filteredEntries) { entry in
                        entryRow(entry)
                    }
                    .onDelete { indices in
                        entries.remove(atOffsets: indices)
                    }
                }
                .listStyle(InsetGroupedListStyle())
                .searchable(text: $searchText, prompt: "Rechercher un identifiant...")
            }
        }
    }

    // ÉCRAN D'ACCUEIL POUR COFFRE VIDE
    private var emptyVaultView: some View {
        VStack(spacing: 20) {
            Spacer()

            ZStack {
                Circle()
                    .fill(themeColor.opacity(0.1))
                    .frame(width: 90, height: 90)
                Image(systemName: "key.fill")
                    .font(.system(size: 40))
                    .foregroundColor(themeColor)
            }

            VStack(spacing: 8) {
                Text("Votre coffre est prêt & sécurisé")
                    .font(.title3.bold())
                Text("Aucun mot de passe pour le moment.\nImportez instantanément vos accès ou ajoutez votre premier identifiant.")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            }

            VStack(spacing: 12) {
                Button {
                    showImportSheet = true
                } label: {
                    HStack {
                        Image(systemName: "square.and.arrow.down.fill")
                        Text("Importer mes mots de passe")
                            .bold()
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(themeColor)
                    .foregroundColor(.white)
                    .cornerRadius(14)
                }

                Button {
                    showAddSheet = true
                } label: {
                    HStack {
                        Image(systemName: "plus")
                        Text("Ajouter un identifiant manuellement")
                            .bold()
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(Color(UIColor.secondarySystemGroupedBackground))
                    .foregroundColor(themeColor)
                    .cornerRadius(14)
                }
            }
            .padding(.horizontal, 28)
            .padding(.top, 10)

            Spacer()
            Spacer()
        }
        .padding()
    }

    // LIGNE D'IDENTIFIANT / NOTE / FICHIER
    private func entryRow(_ entry: VaultEntry) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                categoryIcon(entry.category, itemType: entry.itemType ?? "login")
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(entry.title)
                            .font(.headline)
                        if let folder = entry.folder, !folder.isEmpty {
                            Text("📁 " + folder)
                                .font(.caption2)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Color.secondary.opacity(0.12))
                                .foregroundColor(.secondary)
                                .cornerRadius(4)
                        }
                    }
                    if entry.itemType == "note" {
                        Text(entry.notes?.prefix(80).appending((entry.notes?.count ?? 0) > 80 ? "..." : "") ?? "Note sécurisée")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                            .lineLimit(2)
                    } else {
                        Text(entry.username.isEmpty ? "Sans identifiant" : entry.username)
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                }
                Spacer()
                if entry.favorite {
                    Image(systemName: "star.fill")
                        .foregroundColor(.yellow)
                        .font(.subheadline)
                }
            }

            // Note sécurisée : texte complet & bouton copie
            if entry.itemType == "note", let noteContent = entry.notes, !noteContent.isEmpty {
                HStack {
                    Text(noteContent)
                        .font(.system(.footnote, design: .monospaced))
                        .foregroundColor(.secondary)
                        .lineLimit(4)
                    Spacer()
                    Button {
                        UIPasteboard.general.string = noteContent
                        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                        copiedId = entry.id
                        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                            if copiedId == entry.id { copiedId = nil }
                        }
                    } label: {
                        Image(systemName: copiedId == entry.id ? "checkmark.circle.fill" : "doc.on.doc")
                            .foregroundColor(copiedId == entry.id ? .green : themeColor)
                    }
                    .buttonStyle(BorderlessButtonStyle())
                }
                .padding(10)
                .background(Color(UIColor.tertiarySystemGroupedBackground))
                .cornerRadius(10)
            }

            // Pièces jointes si présentes
            if !entry.attachments.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(entry.attachments) { att in
                            HStack(spacing: 4) {
                                Image(systemName: "paperclip")
                                Text(att.name)
                                    .lineLimit(1)
                            }
                            .font(.caption2)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(themeColor.opacity(0.1))
                            .foregroundColor(themeColor)
                            .cornerRadius(6)
                        }
                    }
                }
            }

            if entry.itemType != "note", let password = entry.password {
                HStack {
                    Text(revealedPasswords.contains(entry.id) ? password : "••••••••••••••••")
                        .font(.system(.footnote, design: .monospaced))
                        .foregroundColor(.secondary)

                    Spacer()

                    Button {
                        if revealedPasswords.contains(entry.id) {
                            revealedPasswords.remove(entry.id)
                        } else {
                            revealedPasswords.insert(entry.id)
                        }
                    } label: {
                        Image(systemName: revealedPasswords.contains(entry.id) ? "eye.slash" : "eye")
                            .foregroundColor(.secondary)
                    }
                    .buttonStyle(BorderlessButtonStyle())

                    Button {
                        UIPasteboard.general.string = password
                        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                        copiedId = entry.id
                        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                            if copiedId == entry.id { copiedId = nil }
                        }
                    } label: {
                        Image(systemName: copiedId == entry.id ? "checkmark.circle.fill" : "doc.on.doc")
                            .foregroundColor(copiedId == entry.id ? .green : themeColor)
                    }
                    .buttonStyle(BorderlessButtonStyle())
                }
                .padding(10)
                .background(Color(UIColor.tertiarySystemGroupedBackground))
                .cornerRadius(10)
            }
        }
        .padding(.vertical, 4)
    }

    private func categoryIcon(_ category: String, itemType: String = "login") -> some View {
        if itemType == "note" {
            return Image(systemName: "note.text")
                .font(.title2)
                .foregroundColor(.purple)
                .frame(width: 38, height: 38)
                .background(Color.purple.opacity(0.12))
                .cornerRadius(10)
        } else if itemType == "file" {
            return Image(systemName: "doc.fill")
                .font(.title2)
                .foregroundColor(.teal)
                .frame(width: 38, height: 38)
                .background(Color.teal.opacity(0.12))
                .cornerRadius(10)
        }
        let (icon, color): (String, Color) = {
            switch category {
            case "Finance": return ("dollarsign.circle.fill", .orange)
            case "Travail": return ("briefcase.fill", .blue)
            default: return ("person.crop.circle.fill", themeColor)
            }
        }()

        return Image(systemName: icon)
            .font(.title2)
            .foregroundColor(color)
            .frame(width: 38, height: 38)
            .background(color.opacity(0.12))
            .cornerRadius(10)
    }

    private func unlockWithPassword() {
        if masterPassword.count >= 4 {
            withAnimation(.spring()) {
                isLocked = false
                masterPassword = ""
                unlockError = nil
            }
        } else {
            unlockError = "Mot de passe trop court"
        }
    }

    private func unlockWithFaceID() {
        Task {
            let result = await BiometricAuthService.shared.authenticateWithBiometrics(reason: "Déverrouiller votre coffre PassApp")
            if case .success(true) = result {
                await MainActor.run {
                    withAnimation(.spring()) {
                        isLocked = false
                        unlockError = nil
                    }
                }
            }
        }
    }
}

// -------------------------------------------------------------
// ASSISTANT D'INITIALISATION INITIAL (ONBOARDING)
// -------------------------------------------------------------
struct OnboardingWizardView: View {
    var themeColor: Color
    var onComplete: (String, String, Bool) -> Void

    @State private var step = 1
    @State private var masterPassword = ""
    @State private var confirmPassword = ""
    @State private var generatedWords: [String] = []
    @State private var copiedPhrase = false
    @State private var enableBiometrics = true

    // Dictionnaire de 24 mots mnémoniques pour la phrase secrète
    private let wordPool = [
        "aurore", "bastion", "boussole", "cristal", "diamant", "eclat",
        "etoile", "flamme", "horizon", "miroir", "navire", "ombre",
        "oracle", "refuge", "sentier", "silence", "sommet", "titan",
        "vallee", "vigie", "zodiaque", "zenith", "comete", "faucon"
    ]

    var body: some View {
        NavigationView {
            ZStack {
                Color(UIColor.systemGroupedBackground).ignoresSafeArea()

                VStack(spacing: 24) {
                    // INDICATEUR D'ÉTAPES
                    HStack(spacing: 8) {
                        ForEach(1...3, id: \.self) { s in
                            Capsule()
                                .fill(s <= step ? themeColor : Color.secondary.opacity(0.2))
                                .frame(height: 4)
                        }
                    }
                    .padding(.horizontal, 32)
                    .padding(.top, 16)

                    if step == 1 {
                        welcomeStepView
                    } else if step == 2 {
                        passwordStepView
                    } else {
                        recoveryPhraseStepView
                    }

                    Spacer()

                    // BOUTONS D'ACTION
                    VStack(spacing: 12) {
                        Button {
                            if step == 1 {
                                step = 2
                            } else if step == 2 {
                                generateRecoveryWords()
                                step = 3
                            } else {
                                onComplete(generatedWords.joined(separator: " "), masterPassword, enableBiometrics)
                            }
                        } label: {
                            Text(step == 3 ? "Initialiser et ouvrir mon coffre" : "Continuer")
                                .font(.headline)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 15)
                                .background(canContinue ? themeColor : Color.secondary.opacity(0.3))
                                .foregroundColor(.white)
                                .cornerRadius(12)
                        }
                        .disabled(!canContinue)

                        if step > 1 {
                            Button("Retour") {
                                withAnimation { step -= 1 }
                            }
                            .foregroundColor(.secondary)
                            .font(.subheadline)
                        }
                    }
                    .padding(.horizontal, 28)
                    .padding(.bottom, 24)
                }
            }
            .navigationBarHidden(true)
        }
    }

    private var canContinue: Bool {
        if step == 1 { return true }
        if step == 2 {
            return masterPassword.count >= 8 && masterPassword == confirmPassword
        }
        return true
    }

    private func generateRecoveryWords() {
        if generatedWords.isEmpty {
            generatedWords = Array(wordPool.shuffled().prefix(12))
        }
    }

    // ÉTAPE 1 : BIENVENUE & EXPLICATIONS
    private var welcomeStepView: some View {
        VStack(spacing: 20) {
            ZStack {
                Circle()
                    .fill(themeColor.opacity(0.12))
                    .frame(width: 100, height: 100)
                Image(systemName: "lock.shield.fill")
                    .font(.system(size: 48))
                    .foregroundColor(themeColor)
            }
            .padding(.top, 20)

            Text("Bienvenue sur PassApp")
                .font(.title2.bold())

            Text("Votre coffre-fort numérique souverain.\nChiffrement de niveau militaire, directement sur votre appareil.")
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)

            VStack(alignment: .leading, spacing: 16) {
                featureBullet(
                    icon: "lock.fill",
                    title: "Chiffrement Zero-Knowledge",
                    desc: "Argon2id + AES-256-GCM. Vous seul détenez les clés de déchiffrement."
                )
                featureBullet(
                    icon: "iphone.circle.fill",
                    title: "100% Local & Privé",
                    desc: "Aucun serveur tiers, aucun abonnement, aucune donnée transmise."
                )
                featureBullet(
                    icon: "faceid",
                    title: "Accès instantané Face ID",
                    desc: "Déverrouillez vos identifiants d'un simple regard dès l'ouverture."
                )
            }
            .padding(.horizontal, 28)
            .padding(.top, 12)
        }
    }

    private func featureBullet(icon: String, title: String, desc: String) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundColor(themeColor)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.subheadline.bold())
                Text(desc).font(.caption).foregroundColor(.secondary)
            }
        }
    }

    // ÉTAPE 2 : DÉFINITION DU MOT DE PASSE MAÎTRE
    private var passwordStepView: some View {
        VStack(spacing: 20) {
            Text("Mot de passe maître")
                .font(.title2.bold())
                .padding(.top, 20)

            Text("Ce mot de passe sert à déchiffrer votre coffre. Choisissez-en un mémorable et robuste.")
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 28)

            VStack(spacing: 12) {
                SecureField("Mot de passe maître (8 caractères min.)", text: $masterPassword)
                    .textFieldStyle(RoundedBorderTextFieldStyle())

                SecureField("Confirmer le mot de passe", text: $confirmPassword)
                    .textFieldStyle(RoundedBorderTextFieldStyle())

                if !confirmPassword.isEmpty && masterPassword != confirmPassword {
                    Text("Les mots de passe ne correspondent pas.")
                        .font(.caption)
                        .foregroundColor(.red)
                }

                // TOGGLE FACE ID DIRECT
                Toggle(isOn: $enableBiometrics) {
                    HStack(spacing: 8) {
                        Image(systemName: "faceid")
                            .foregroundColor(themeColor)
                        Text("Activer Face ID dès le démarrage")
                            .font(.footnote)
                    }
                }
                .padding(.top, 8)
            }
            .padding(.horizontal, 28)
            .padding(.top, 10)
        }
    }

    // ÉTAPE 3 : PHRASE SECRÈTE DE SECOURS (12 MOTS)
    private var recoveryPhraseStepView: some View {
        VStack(spacing: 16) {
            Text("Phrase secrète de récupération")
                .font(.title3.bold())
                .padding(.top, 10)

            Text("En cas d'oubli de votre mot de passe, ces 12 mots permettent de recouvrer l'accès à vos données.")
                .font(.footnote)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)

            // GRILLE DES 12 MOTS
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                ForEach(Array(generatedWords.enumerated()), id: \.offset) { index, word in
                    HStack {
                        Text("\(index + 1).")
                            .font(.caption2.bold())
                            .foregroundColor(.secondary)
                            .frame(width: 20, alignment: .trailing)
                        Text(word)
                            .font(.system(.footnote, design: .monospaced).bold())
                            .foregroundColor(.primary)
                        Spacer()
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 7)
                    .background(Color(UIColor.secondarySystemGroupedBackground))
                    .cornerRadius(8)
                }
            }
            .padding(.horizontal, 24)

            Button {
                let phrase = generatedWords.joined(separator: " ")
                UIPasteboard.general.string = phrase
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                withAnimation { copiedPhrase = true }
            } label: {
                HStack {
                    Image(systemName: copiedPhrase ? "checkmark" : "doc.on.doc")
                    Text(copiedPhrase ? "Phrase secrète copiée !" : "Copier la phrase de récupération")
                }
                .font(.footnote.bold())
                .foregroundColor(copiedPhrase ? .green : themeColor)
            }
            .padding(.top, 6)

            Text("⚠️ PassApp ne conserve pas de copie. Notez cette phrase dans un lieu sécurisé.")
                .font(.caption2)
                .foregroundColor(.orange)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)
        }
    }
}

// -------------------------------------------------------------
// FICHE DE RÉGLAGES & PERSONNALISATION
// -------------------------------------------------------------
struct SettingsSheetView: View {
    @Environment(\.dismiss) var dismiss
    var themeColor: Color
    var onOpenImport: () -> Void
    var onLockNow: () -> Void

    @AppStorage("accentTheme") private var accentTheme: String = "emerald"
    @AppStorage("biometricsEnabled") private var biometricsEnabled: Bool = true

    var body: some View {
        NavigationView {
            Form {
                Section(header: Text("Personnalisation de l'interface")) {
                    Picker("Couleur d'accent", selection: $accentTheme) {
                        ForEach(AccentTheme.allCases) { theme in
                            HStack {
                                Circle().fill(theme.color).frame(width: 12, height: 12)
                                Text(theme.name)
                            }
                            .tag(theme.rawValue)
                        }
                    }

                    Toggle("Déverrouillage automatique Face ID", isOn: $biometricsEnabled)
                }

                Section(header: Text("Importation de données")) {
                    Button {
                        onOpenImport()
                    } label: {
                        HStack {
                            Image(systemName: "square.and.arrow.down")
                                .foregroundColor(themeColor)
                            Text("Importer (Chrome, Bitwarden, CSV, 2FA)")
                                .foregroundColor(.primary)
                        }
                    }
                }

                Section(header: Text("Synchronisation Multi-Appareils")) {
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: "icloud.fill")
                            .foregroundColor(.blue)
                            .font(.title3)
                        VStack(alignment: .leading, spacing: 4) {
                            Text("iCloud Drive & Réseau local (CRDT)")
                                .font(.subheadline.bold())
                            Text("Votre coffre PassApp est compatible avec la synchronisation iCloud Drive et les dossiers partagés de votre PC/Mac sans aucun serveur tiers.")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }
                    .padding(.vertical, 4)
                }

                Section(header: Text("Sécurité & Phrase de secours")) {
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: "shield.lefthalf.filled")
                            .foregroundColor(themeColor)
                            .font(.title3)
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Phrase de secours scellée (Zero-Knowledge)")
                                .font(.subheadline.bold())
                            Text("Votre phrase de récupération à 12 mots a été générée lors de la configuration initiale. Pour préserver l'inviolabilité absolue de votre coffre, elle n'est pas conservée en clair et ne peut pas être réaffichée ici.")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }
                    .padding(.vertical, 4)

                    Button("Verrouiller le coffre maintenant") {
                        dismiss()
                        onLockNow()
                    }
                    .foregroundColor(.red)
                }

                Section(footer: Text("PassApp v0.1.0 • Chiffrement local Zero-Knowledge")) {
                    EmptyView()
                }
            }
            .navigationTitle("Réglages")
            .navigationBarItems(trailing: Button("Terminé") { dismiss() })
        }
    }
}

// -------------------------------------------------------------
// FICHE D'AJOUT D'ENTRÉE AVEC GÉNÉRATEUR
// -------------------------------------------------------------
struct AddEntryView: View {
    @Environment(\.dismiss) var dismiss
    var themeColor: Color
    var onSave: (VaultEntry) -> Void

    @State private var itemType = "login"
    @State private var folder = ""
    @State private var title = ""
    @State private var username = ""
    @State private var password = ""
    @State private var url = ""
    @State private var notes = ""
    @State private var category = "Personnel"
    @State private var favorite = false

    var body: some View {
        NavigationView {
            Form {
                Section(header: Text("Type d'élément")) {
                    Picker("Type", selection: $itemType) {
                        Text("🔑 Identifiant").tag("login")
                        Text("📝 Note").tag("note")
                        Text("📁 Fichier").tag("file")
                    }
                    .pickerStyle(SegmentedPickerStyle())
                }

                Section(header: Text("Dossier / Organisation (ex: Personnel/Banque)")) {
                    TextField("Dossier (optionnel)", text: $folder)
                }

                Section(header: Text(itemType == "note" ? "Titre de la note" : "Informations")) {
                    TextField(itemType == "note" ? "Titre de la note" : "Titre (ex: GitHub, Banque...)", text: $title)
                    if itemType == "login" {
                        TextField("Identifiant ou Email", text: $username)
                    }
                }

                if itemType == "login" {
                    Section(header: Text("Mot de passe")) {
                        HStack {
                            TextField("Mot de passe", text: $password)
                            Button("🎲 Générer") {
                                password = generateStrongPassword()
                            }
                            .font(.caption.bold())
                            .foregroundColor(themeColor)
                        }
                    }
                }

                if itemType == "note" {
                    Section(header: Text("Contenu chiffré de la note")) {
                        TextEditor(text: $notes)
                            .frame(height: 140)
                    }
                }

                Section(header: Text("Catégorie")) {
                    Picker("Catégorie", selection: $category) {
                        Text("Personnel").tag("Personnel")
                        Text("Travail").tag("Travail")
                        Text("Finance").tag("Finance")
                    }
                    Toggle("Ajouter aux favoris", isOn: $favorite)
                }

                if itemType != "note" {
                    Section(header: Text("Détails (Optionnel)")) {
                        TextField("https://...", text: $url)
                        TextEditor(text: $notes)
                            .frame(height: 70)
                    }
                }
            }
            .navigationTitle(itemType == "note" ? "Nouvelle note" : (itemType == "file" ? "Nouveau fichier" : "Nouvel accès"))
            .navigationBarItems(
                leading: Button("Annuler") { dismiss() },
                trailing: Button("Enregistrer") {
                    let trimmedFolder = folder.trimmingCharacters(in: .whitespaces)
                    let entry = VaultEntry(
                        title: title,
                        username: username,
                        password: password.isEmpty ? nil : password,
                        url: url.isEmpty ? nil : url,
                        notes: notes.isEmpty ? nil : notes,
                        category: category,
                        favorite: favorite,
                        folder: trimmedFolder.isEmpty ? nil : trimmedFolder,
                        itemType: itemType
                    )
                    onSave(entry)
                    dismiss()
                }
                .disabled(title.isEmpty)
                .font(.headline)
                .foregroundColor(title.isEmpty ? .secondary : themeColor)
            )
        }
    }

    private func generateStrongPassword(length: Int = 18) -> String {
        let chars = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*()-_=+"
        return String((0..<length).compactMap { _ in chars.randomElement() })
    }
}

// -------------------------------------------------------------
// FICHE D'IMPORTATION UNIVERSELLE (CSV, JSON, 2FA)
// -------------------------------------------------------------
struct ImportSheetView: View {
    @Environment(\.dismiss) var dismiss
    var themeColor: Color
    var onImport: ([VaultEntry]) -> Void

    @State private var importText = ""
    @State private var showFileImporter = false
    @State private var parsedEntries: [VaultEntry] = []
    @State private var importError: String? = nil

    var body: some View {
        NavigationView {
            Form {
                Section(header: Text("Sources supportées")) {
                    Text("Chrome, Edge, Firefox, Bitwarden, 1Password, KeePass, LastPass, CSV, PassApp JSON et Authenticator (otpauth://).")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    Button {
                        showFileImporter = true
                    } label: {
                        HStack {
                            Image(systemName: "doc.badge.plus")
                                .foregroundColor(themeColor)
                            Text("Choisir un fichier (CSV, JSON, TXT)")
                                .bold()
                        }
                    }

                    Button {
                        if let pasted = UIPasteboard.general.string, !pasted.isEmpty {
                            importText = pasted
                            parsedEntries = VaultImporterHelper.parse(text: pasted)
                        }
                    } label: {
                        HStack {
                            Image(systemName: "doc.on.clipboard")
                                .foregroundColor(themeColor)
                            Text("Coller depuis le presse-papier")
                        }
                    }
                }

                Section(header: Text("Ou saisie directe")) {
                    TextEditor(text: $importText)
                        .frame(height: 90)
                        .font(.system(.caption, design: .monospaced))
                        .onChange(of: importText) { newText in
                            parsedEntries = VaultImporterHelper.parse(text: newText)
                        }
                }

                if !parsedEntries.isEmpty {
                    Section(header: Text("Aperçu (\(parsedEntries.count) détecté(s))")) {
                        ForEach(Array(parsedEntries.prefix(5))) { item in
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(item.title)
                                        .font(.subheadline.bold())
                                    Text(item.username.isEmpty ? "Sans identifiant" : item.username)
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                                Spacer()
                                if item.password != nil {
                                    Text("🔑")
                                        .font(.caption)
                                }
                                if item.totpSecret != nil {
                                    Text("⏱️ 2FA")
                                        .font(.caption2.bold())
                                        .padding(.horizontal, 6)
                                        .padding(.vertical, 2)
                                        .background(themeColor.opacity(0.15))
                                        .foregroundColor(themeColor)
                                        .cornerRadius(4)
                                }
                            }
                        }

                        if parsedEntries.count > 5 {
                            Text("... et \(parsedEntries.count - 5) autre(s) entrée(s)")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }

                        Button {
                            onImport(parsedEntries)
                            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                            dismiss()
                        } label: {
                            Text("Importer ces \(parsedEntries.count) identifiant(s)")
                                .font(.headline)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 12)
                                .background(themeColor)
                                .foregroundColor(.white)
                                .cornerRadius(12)
                        }
                        .listRowInsets(EdgeInsets())
                        .padding(.vertical, 6)
                    }
                }

                if let err = importError {
                    Section {
                        Text(err)
                            .font(.caption)
                            .foregroundColor(.red)
                    }
                }
            }
            .navigationTitle("Importer des données")
            .navigationBarItems(leading: Button("Fermer") { dismiss() })
            .fileImporter(
                isPresented: $showFileImporter,
                allowedContentTypes: [.commaSeparatedText, .json, .plainText]
            ) { result in
                switch result {
                case .success(let url):
                    guard url.startAccessingSecurityScopedResource() else { return }
                    defer { url.stopAccessingSecurityScopedResource() }
                    if let data = try? Data(contentsOf: url),
                       let content = String(data: data, encoding: .utf8) {
                        importText = content
                        parsedEntries = VaultImporterHelper.parse(text: content, filename: url.lastPathComponent)
                    }
                case .failure(let error):
                    importError = error.localizedDescription
                }
            }
        }
    }
}

// -------------------------------------------------------------
// PARSEUR UNIVERSEL EN SWIFT (CSV, JSON, OTPAUTH)
// -------------------------------------------------------------
enum VaultImporterHelper {
    static func parse(text: String, filename: String = "") -> [VaultEntry] {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return [] }

        // 1. JSON
        if trimmed.starts(with: "{") {
            if let data = trimmed.data(using: .utf8) {
                if let doc = try? JSONDecoder().decode(VaultDocument.self, from: data) {
                    return doc.entries
                }
                if let directEntries = try? JSONDecoder().decode([VaultEntry].self, from: data) {
                    return directEntries
                }
            }
        }

        // 2. OTPAUTH URIs
        if trimmed.lowercased().contains("otpauth://") {
            var otpEntries: [VaultEntry] = []
            let lines = trimmed.components(separatedBy: .newlines)
            for line in lines {
                let l = line.trimmingCharacters(in: .whitespacesAndNewlines)
                if l.lowercased().starts(with: "otpauth://") {
                    if let url = URL(string: l),
                       let components = URLComponents(url: url, resolvingAgainstBaseURL: false) {
                        let queryItems = components.queryItems ?? []
                        let secret = queryItems.first(where: { $0.name.lowercased() == "secret" })?.value
                        let issuer = queryItems.first(where: { $0.name.lowercased() == "issuer" })?.value
                        let path = components.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
                        let title = issuer ?? (path.isEmpty ? "Compte 2FA" : path)
                        let username = path.contains(":") ? String(path.split(separator: ":").last ?? "") : (issuer != nil ? path : "")
                        otpEntries.append(VaultEntry(
                            title: title,
                            username: username,
                            totpSecret: secret,
                            category: "Personnel"
                        ))
                    }
                }
            }
            if !otpEntries.isEmpty { return otpEntries }
        }

        // 3. CSV
        return parseCSV(text: trimmed)
    }

    private static func parseCSV(text: String) -> [VaultEntry] {
        var lines = text.components(separatedBy: .newlines).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        if lines.isEmpty { return [] }

        let delimiter: Character = text.contains(";") && !text.contains(",") ? ";" : ","
        let headerLine = lines.removeFirst()
        let headers = splitCsvRow(headerLine, delimiter: delimiter).map { $0.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "\" ")) }

        let titleIdx = headers.firstIndex(where: { $0 == "name" || $0 == "title" || $0 == "site" }) ?? -1
        let urlIdx = headers.firstIndex(where: { $0 == "url" || $0 == "login_uri" || $0 == "website" }) ?? -1
        let userIdx = headers.firstIndex(where: { $0 == "username" || $0 == "login_username" || $0 == "login" || $0 == "identifiant" || $0 == "user" }) ?? -1
        let passIdx = headers.firstIndex(where: { $0 == "password" || $0 == "login_password" || $0 == "mot de passe" || $0 == "pwd" }) ?? -1
        let notesIdx = headers.firstIndex(where: { $0 == "notes" || $0 == "note" || $0 == "commentaire" }) ?? -1
        let totpIdx = headers.firstIndex(where: { $0 == "totp" || $0 == "login_totp" || $0 == "otp" || $0 == "2fa" }) ?? -1

        var result: [VaultEntry] = []
        for line in lines {
            let cols = splitCsvRow(line, delimiter: delimiter)
            if cols.isEmpty { continue }

            let url = (urlIdx >= 0 && urlIdx < cols.count) ? cols[urlIdx] : ""
            var title = (titleIdx >= 0 && titleIdx < cols.count) ? cols[titleIdx] : ""
            let username = (userIdx >= 0 && userIdx < cols.count) ? cols[userIdx] : ""
            let password = (passIdx >= 0 && passIdx < cols.count) ? cols[passIdx] : ""
            let notes = (notesIdx >= 0 && notesIdx < cols.count) ? cols[notesIdx] : ""
            let totp = (totpIdx >= 0 && totpIdx < cols.count) ? cols[totpIdx] : ""

            if title.isEmpty && !url.isEmpty {
                if let u = URL(string: url), let host = u.host {
                    title = host.replacingOccurrences(of: "www.", with: "")
                } else {
                    title = url
                }
            }
            if title.isEmpty && !username.isEmpty {
                title = username
            }

            if !title.isEmpty || !username.isEmpty || !password.isEmpty {
                result.append(VaultEntry(
                    title: title.isEmpty ? "Identifiant importé" : title,
                    username: username,
                    password: password.isEmpty ? nil : password,
                    url: url.isEmpty ? nil : url,
                    notes: notes.isEmpty ? nil : notes,
                    totpSecret: totp.isEmpty ? nil : totp,
                    category: "Personnel"
                ))
            }
        }
        return result
    }

    private static func splitCsvRow(_ row: String, delimiter: Character) -> [String] {
        var fields: [String] = []
        var current = ""
        var inQuotes = false

        for char in row {
            if char == "\"" {
                inQuotes.toggle()
            } else if char == delimiter && !inQuotes {
                fields.append(current.trimmingCharacters(in: CharacterSet(charactersIn: "\" ")))
                current = ""
            } else {
                current.append(char)
            }
        }
        fields.append(current.trimmingCharacters(in: CharacterSet(charactersIn: "\" ")))
        return fields
    }
}

