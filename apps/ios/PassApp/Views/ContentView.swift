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
    @Environment(\.scenePhase) private var scenePhase
    @State private var vaultExists = LocalVault.exists
    @State private var session: LocalVault.Session?
    @State private var busy = false
    @State private var saveError: String?
    @AppStorage("accentTheme") private var accentTheme: String = "emerald"
    @AppStorage("localVaultBiometricsV1") private var biometricsEnabled = false

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
            if !vaultExists {
                OnboardingWizardView(themeColor: themeColor, busy: busy, error: unlockError,
                                     onComplete: createVault)
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
                            if !isLocked {
                                Button(action: lock) {
                                    Image(systemName: "lock.open.fill").foregroundColor(themeColor)
                                }
                                .accessibilityLabel("Verrouiller")
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
                            save([newEntry] + entries)
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
                            onLockNow: lock,
                            biometricsEnabled: Binding(get: { biometricsEnabled }, set: setBiometrics)
                        )
                    }
                    .sheet(isPresented: $showImportSheet) {
                        ImportSheetView(themeColor: themeColor) { importedEntries in
                            var existing = Set(entries.map(\.id))
                            let additions = importedEntries.filter { existing.insert($0.id).inserted }
                            save(additions + entries)
                        }
                    }
                }

            }
        }
        .tint(themeColor)
        .onChange(of: scenePhase) { phase in
            if phase == .background { lock() }
        }
        .overlay {
            if scenePhase != .active {
                Color(UIColor.systemBackground).ignoresSafeArea().accessibilityHidden(true)
            }
        }
        .alert("Coffre", isPresented: Binding(
            get: { saveError != nil },
            set: { if !$0 { saveError = nil } }
        )) {
            Button("OK", role: .cancel) { saveError = nil }
        } message: {
            Text(saveError ?? "")
        }
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

                if busy { ProgressView() }
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
                        let visible = filteredEntries
                        let ids = Set(indices.compactMap { visible.indices.contains($0) ? visible[$0].id : nil })
                        save(entries.filter { !ids.contains($0.id) })
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
                        copyLocally(noteContent)
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
                        copyLocally(password)
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

    private func createVault(password: String, enableBiometrics: Bool) {
        guard !busy, password.count >= 12 else { return }
        busy = true
        unlockError = nil
        Task { @MainActor in
            defer { busy = false }
            do {
                let created = try await Task.detached(priority: .userInitiated) {
                    try LocalVault.create(password: password)
                }.value
                vaultExists = true
                guard scenePhase != .background else { return }
                open(session: created, entries: [])
                setBiometrics(enableBiometrics)
            } catch { unlockError = error.localizedDescription }
        }
    }

    private func unlockWithPassword() {
        guard !busy, !masterPassword.isEmpty else { return }
        let supplied = masterPassword
        masterPassword = ""
        authenticate { try LocalVault.unlock(password: supplied) }
    }

    private func unlockWithFaceID() {
        authenticate { try LocalVault.unlockUsingBiometrics() }
    }

    private func authenticate(_ operation: @escaping @Sendable () throws -> (LocalVault.Session, [VaultEntry])) {
        guard !busy else { return }
        busy = true
        unlockError = nil
        Task { @MainActor in
            defer { busy = false }
            do {
                let (session, entries) = try await Task.detached(priority: .userInitiated) { try operation() }.value
                guard scenePhase != .background else { return }
                open(session: session, entries: entries)
            } catch { unlockError = error.localizedDescription }
        }
    }

    private func open(session: LocalVault.Session, entries: [VaultEntry]) {
        self.session = session
        self.entries = entries
        unlockError = nil
        isLocked = false
    }

    private func lock() {
        isLocked = true
        session = nil
        entries.removeAll()
        masterPassword = ""
        searchText = ""
        selectedFolder = nil
        revealedPasswords.removeAll()
        copiedId = nil
        showAddSheet = false
        showImportSheet = false
        showSettingsSheet = false
    }

    private func save(_ updated: [VaultEntry]) {
        guard let session, !isLocked else { return }
        do {
            try LocalVault.save(updated, session: session)
            entries = updated
        } catch {
            saveError = "Impossible d’enregistrer cette modification. Vérifiez l’espace disponible."
        }
    }

    private func setBiometrics(_ enabled: Bool) {
        guard enabled else {
            LocalVault.removeBiometrics()
            biometricsEnabled = false
            return
        }
        guard let session else { return }
        do {
            try LocalVault.enableBiometrics(for: session)
            biometricsEnabled = true
        } catch {
            biometricsEnabled = false
            saveError = error.localizedDescription
        }
    }

    private func copyLocally(_ secret: String) {
        UIPasteboard.general.setItems([[UTType.utf8PlainText.identifier: secret]],
                                     options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(30)])
    }
}

private struct OnboardingWizardView: View {
    let themeColor: Color
    let busy: Bool
    let error: String?
    let onComplete: (String, Bool) -> Void
    @State private var password = ""
    @State private var confirmation = ""
    @State private var enableBiometrics = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    SecureField("Mot de passe principal", text: $password)
                        .textContentType(.newPassword)
                    SecureField("Confirmer le mot de passe", text: $confirmation)
                        .textContentType(.newPassword)
                    Toggle("Déverrouillage biométrique", isOn: $enableBiometrics)
                } header: {
                    Text("Sécurité")
                } footer: {
                    Text("Utilisez au moins 12 caractères et gardez ce mot de passe dans un endroit sûr.")
                }
                if let error {
                    Text(error).foregroundStyle(.red)
                }
                Button("Créer mon coffre") { onComplete(password, enableBiometrics) }
                    .disabled(busy || password.count < 12 || password != confirmation)
                if busy { ProgressView() }
            }
            .navigationTitle("Créer un coffre")
            .tint(themeColor)
        }
    }
}

struct SettingsSheetView: View {
    @Environment(\.dismiss) var dismiss
    var themeColor: Color
    var onOpenImport: () -> Void
    var onLockNow: () -> Void

    @AppStorage("accentTheme") private var accentTheme: String = "emerald"
    @Binding var biometricsEnabled: Bool

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

                    Toggle("Déverrouillage biométrique", isOn: $biometricsEnabled)
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

                Section("Sécurité") {
                    Text("Ce coffre est chiffré et enregistré sur l’iPhone.")
                        .foregroundStyle(.secondary)

                    Button("Verrouiller le coffre maintenant") {
                        dismiss()
                        onLockNow()
                    }
                    .foregroundColor(.red)
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

