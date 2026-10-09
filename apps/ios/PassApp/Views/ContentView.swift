import SwiftUI

public struct ContentView: View {
    @State private var isLocked = true
    @State private var masterPassword = ""
    @State private var entries: [VaultEntry] = [
        VaultEntry(
            title: "Courriel personnel",
            username: "alexandre@exemple.fr",
            password: "Password123!Secure",
            url: "https://mail.exemple.fr",
            notes: "Compte personnel",
            category: "Personnel",
            favorite: true
        ),
        VaultEntry(
            title: "Banque principale",
            username: "Alexandre Martin",
            password: "BankPass987$Secure",
            url: "https://banque.exemple.fr",
            notes: "Identifiant client",
            category: "Finance",
            favorite: true
        ),
        VaultEntry(
            title: "Espace de travail",
            username: "alexandre.martin",
            password: "WorkPass456#Office",
            url: "https://workspace.entreprise.fr",
            notes: "Accès SSO",
            category: "Travail",
            favorite: false
        )
    ]
    @State private var searchText = ""
    @State private var selectedCategory = "Tous"
    @State private var showAddSheet = false
    @State private var revealedPasswords: Set<String> = []
    @State private var copiedId: String? = nil

    private let categories = ["Tous", "Favoris", "Personnel", "Travail", "Finance"]

    private var filteredEntries: [VaultEntry] {
        if isLocked { return [] }
        return entries.filter { entry in
            let matchesCategory: Bool
            if selectedCategory == "Tous" {
                matchesCategory = true
            } else if selectedCategory == "Favoris" {
                matchesCategory = entry.favorite
            } else {
                matchesCategory = entry.category == selectedCategory
            }

            let matchesSearch = searchText.isEmpty ||
                entry.title.localizedCaseInsensitiveContains(searchText) ||
                entry.username.localizedCaseInsensitiveContains(searchText)

            return matchesCategory && matchesSearch
        }
    }

    public init() {}

    public var body: some View {
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
                ToolbarItem(placement: .navigationBarTrailing) {
                    if !isLocked {
                        Button {
                            showAddSheet = true
                        } label: {
                            Image(systemName: "plus")
                        }
                    }
                }
                ToolbarItem(placement: .navigationBarLeading) {
                    Button {
                        withAnimation {
                            isLocked.toggle()
                            if isLocked {
                                masterPassword = ""
                                revealedPasswords.removeAll()
                            }
                        }
                    } label: {
                        Image(systemName: isLocked ? "lock.fill" : "lock.open.fill")
                            .foregroundColor(isLocked ? .orange : .green)
                    }
                }
            }
            .sheet(isPresented: $showAddSheet) {
                AddEntryView { newEntry in
                    entries.insert(newEntry, at: 0)
                }
            }
        }
    }

    private var lockedView: some View {
        VStack(spacing: 24) {
            Image(systemName: "lock.shield.fill")
                .font(.system(size: 64))
                .foregroundColor(.orange)

            Text("Coffre chiffré")
                .font(.title2.bold())

            Text("Saisissez votre mot de passe maître ou utilisez Face ID pour accéder à vos secrets.")
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)

            SecureField("Mot de passe maître", text: $masterPassword)
                .textFieldStyle(RoundedBorderTextFieldStyle())
                .padding(.horizontal, 32)

            Button {
                unlockWithPassword()
            } label: {
                Text("Déverrouiller le coffre")
                    .bold()
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(Color.orange)
                    .foregroundColor(.white)
                    .cornerRadius(10)
            }
            .padding(.horizontal, 32)

            Button {
                unlockWithFaceID()
            } label: {
                HStack {
                    Image(systemName: "faceid")
                    Text("Déverrouiller avec Face ID")
                }
                .font(.footnote.bold())
                .foregroundColor(.orange)
            }
            .padding(.top, 8)
        }
        .padding()
    }

    private var unlockedView: some View {
        VStack(spacing: 0) {
            // Sélecteur de catégories
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(categories, id: \.self) { cat in
                        Button {
                            selectedCategory = cat
                        } label: {
                            Text(cat)
                                .font(.caption.bold())
                                .padding(.horizontal, 14)
                                .padding(.vertical, 8)
                                .background(selectedCategory == cat ? Color.orange : Color(UIColor.secondarySystemGroupedBackground))
                                .foregroundColor(selectedCategory == cat ? .white : .primary)
                                .cornerRadius(20)
                        }
                    }
                }
                .padding(.horizontal)
                .padding(.vertical, 8)
            }

            // Liste des identifiants
            List {
                ForEach(filteredEntries) { entry in
                    entryRow(entry)
                }
                .onDelete { indices in
                    entries.remove(atOffsets: indices)
                }
            }
            .listStyle(InsetGroupedListStyle())
            .searchable(text: $searchText, prompt: "Rechercher dans le coffre")
        }
    }

    private func entryRow(_ entry: VaultEntry) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                categoryIcon(entry.category)
                VStack(alignment: .leading, spacing: 2) {
                    Text(entry.title)
                        .font(.headline)
                    Text(entry.username)
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
                Spacer()
                if entry.favorite {
                    Image(systemName: "star.fill")
                        .foregroundColor(.yellow)
                }
            }

            if let password = entry.password {
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
                        copiedId = entry.id
                        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                            if copiedId == entry.id { copiedId = nil }
                        }
                    } label: {
                        Image(systemName: copiedId == entry.id ? "checkmark" : "doc.on.doc")
                            .foregroundColor(copiedId == entry.id ? .green : .orange)
                    }
                    .buttonStyle(BorderlessButtonStyle())
                }
                .padding(8)
                .background(Color(UIColor.tertiarySystemGroupedBackground))
                .cornerRadius(8)
            }
        }
        .padding(.vertical, 4)
    }

    private func categoryIcon(_ category: String) -> some View {
        let (icon, color): (String, Color) = {
            switch category {
            case "Finance": return ("dollarsign.circle.fill", .orange)
            case "Travail": return ("briefcase.fill", .blue)
            default: return ("person.fill", .teal)
            }
        }()

        return Image(systemName: icon)
            .font(.title3)
            .foregroundColor(color)
            .frame(width: 32, height: 32)
            .background(color.opacity(0.15))
            .cornerRadius(8)
    }

    private func unlockWithPassword() {
        if !masterPassword.isEmpty {
            withAnimation {
                isLocked = false
                masterPassword = ""
            }
        }
    }

    private func unlockWithFaceID() {
        Task {
            let result = await BiometricAuthService.shared.authenticateWithBiometrics()
            if case .success(true) = result {
                await MainActor.run {
                    withAnimation {
                        isLocked = false
                    }
                }
            }
        }
    }
}

struct AddEntryView: View {
    @Environment(\.dismiss) var dismiss
    var onSave: (VaultEntry) -> Void

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
                Section(header: Text("Informations générales")) {
                    TextField("Titre (ex: GitHub, Google)", text: $title)
                    TextField("Identifiant / Email", text: $username)
                }

                Section(header: Text("Sécurité")) {
                    HStack {
                        TextField("Mot de passe", text: $password)
                        Button("Générer") {
                            password = generatePassword()
                        }
                        .font(.caption.bold())
                    }
                }

                Section(header: Text("Catégorie")) {
                    Picker("Catégorie", selection: $category) {
                        Text("Personnel").tag("Personnel")
                        Text("Travail").tag("Travail")
                        Text("Finance").tag("Finance")
                    }
                    Toggle("Favori", isOn: $favorite)
                }

                Section(header: Text("Compléments")) {
                    TextField("URL du site", text: $url)
                    TextEditor(text: $notes)
                        .frame(height: 80)
                }
            }
            .navigationTitle("Nouvelle entrée")
            .navigationBarItems(
                leading: Button("Annuler") { dismiss() },
                trailing: Button("Enregistrer") {
                    let entry = VaultEntry(
                        title: title,
                        username: username,
                        password: password.isEmpty ? nil : password,
                        url: url.isEmpty ? nil : url,
                        notes: notes.isEmpty ? nil : notes,
                        category: category,
                        favorite: favorite
                    )
                    onSave(entry)
                    dismiss()
                }
                .disabled(title.isEmpty)
            )
        }
    }

    private func generatePassword() -> String {
        let chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*"
        return String((0..<16).compactMap { _ in chars.randomElement() })
    }
}
