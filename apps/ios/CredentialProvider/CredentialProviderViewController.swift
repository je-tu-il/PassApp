import AuthenticationServices
import UIKit

public class CredentialProviderViewController: ASCredentialProviderViewController {

    public override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
    }

    public override func prepareCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
        // Appelé par iOS quand l'utilisateur touche un champ identifiant dans Safari ou une app
    }

    public override func provideCredentialWithoutUserInteraction(for credentialIdentity: ASPasswordCredentialIdentity) {
        // Déverrouillage silencieux si la session est active
    }

    public override func prepareInterfaceToProvideCredential(for credentialIdentity: ASPasswordCredentialIdentity) {
        // Affiche l'interface pour autoriser l'autocomplétion
    }
}
